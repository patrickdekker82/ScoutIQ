import { Client } from 'pg';
import { getConfig } from '@/lib/config';
import { prisma } from '@/db/client';

/**
 * SQL analyst interface (§23).
 *
 * SELECT-only by construction, enforced in three independent layers:
 *   1. the statement is parsed and rejected unless it is a single SELECT/WITH
 *   2. it runs inside a READ ONLY transaction, so the database itself refuses
 *      any write even if the parser were fooled
 *   3. a statement timeout and a row cap bound the damage a heavy query can do
 *
 * Layer 2 is the one that actually guarantees safety; layer 1 exists to give a
 * clear error message rather than a Postgres one.
 */

export interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

export class SqlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlValidationError';
  }
}

const FORBIDDEN = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'vacuum',
  'reindex',
  'refresh',
  'call',
  'do',
  'set',
  'reset',
  'listen',
  'notify',
  'lock',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'prepare',
  'execute',
  'discard',
  'cluster',
  'comment',
  'security',
];

/** Strip comments and string literals so keyword checks cannot be smuggled. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''");
}

export function validateSelect(sql: string): string {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (trimmed.length === 0) throw new SqlValidationError('Query is empty');

  const stripped = stripLiterals(trimmed).toLowerCase();

  if (stripped.includes(';')) {
    throw new SqlValidationError('Only a single statement may be executed');
  }

  if (!/^\s*(select|with)\b/.test(stripped)) {
    throw new SqlValidationError('Only SELECT queries are allowed in the SQL console');
  }

  for (const keyword of FORBIDDEN) {
    if (new RegExp(`\\b${keyword}\\b`).test(stripped)) {
      throw new SqlValidationError(
        `"${keyword.toUpperCase()}" is not allowed. The console is read-only; ` +
          'use psql or another client for write access.',
      );
    }
  }

  // `INTO` would let a SELECT create a table.
  if (/\bselect\b[\s\S]*\binto\b/.test(stripped)) {
    throw new SqlValidationError('SELECT ... INTO is not allowed');
  }

  return trimmed;
}

export class SqlService {
  /**
   * Execute a validated read-only query.
   *
   * Uses a dedicated pg connection rather than Prisma so the transaction can
   * genuinely be READ ONLY and carry its own statement timeout.
   */
  async execute(sql: string, ownerId: string): Promise<SqlResult> {
    const config = getConfig();
    if (!config.sqlConsole.enabled) {
      throw new SqlValidationError('The SQL console is disabled (SQL_CONSOLE_ENABLED=false)');
    }

    const statement = validateSelect(sql);
    const started = Date.now();
    const client = new Client({ connectionString: config.database.directUrl });

    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${config.sqlConsole.timeoutMs}`);

      // One extra row tells us whether the result was truncated.
      const limit = config.sqlConsole.maxRows;
      const result = await client.query({
        text: `SELECT * FROM (${statement}) AS scoutiq_console LIMIT ${limit + 1}`,
        rowMode: 'array',
      });

      await client.query('ROLLBACK');

      const columns = result.fields.map((field) => field.name);
      const raw = result.rows as unknown[][];
      const truncated = raw.length > limit;
      const rows = raw.slice(0, limit).map((row) => {
        const record: Record<string, unknown> = {};
        columns.forEach((column, index) => {
          record[column] = row[index];
        });
        return record;
      });

      const durationMs = Date.now() - started;

      await prisma.queryHistory.create({
        data: { ownerId, sql: statement, durationMs, rowCount: rows.length, success: true },
      });

      return { columns, rows, rowCount: rows.length, truncated, durationMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.queryHistory
        .create({
          data: {
            ownerId,
            sql: statement,
            durationMs: Date.now() - started,
            rowCount: 0,
            success: false,
            error: message,
          },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  async history(ownerId: string, limit = 25) {
    return prisma.queryHistory.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async savedQueries(ownerId: string) {
    return prisma.savedQuery.findMany({
      where: { OR: [{ ownerId }, { isShared: true }] },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async saveQuery(ownerId: string, name: string, sql: string, description?: string) {
    validateSelect(sql);
    return prisma.savedQuery.upsert({
      where: { ownerId_name: { ownerId, name } },
      update: { sql, description: description ?? null },
      create: { ownerId, name, sql, description: description ?? null },
    });
  }
}
