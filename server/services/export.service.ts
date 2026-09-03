import { Client } from 'pg';
import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/storage';
import { validateSelect } from '@/server/services/sql.service';

/**
 * Export service (§9, §78).
 *
 * CSV, JSON and SQL exports of any read-only query or whitelisted dataset.
 * Everything runs inside a READ ONLY transaction against the direct
 * connection, and rows are streamed out of pg rather than loaded through
 * Prisma's model layer.
 *
 * Large exports run as background jobs; this service is what the job calls.
 * For a bulk dump of a whole table, `psql -c "\copy (...) TO file CSV HEADER"`
 * is still the fastest path and is documented in docs/sql/README.md.
 */

export type ExportFormat = 'csv' | 'json' | 'sql';

export interface ExportRequest {
  /** Named dataset (see DATASETS) or a raw SELECT. */
  dataset?: string;
  sql?: string;
  format: ExportFormat;
  /** Name without extension; a timestamp is appended. */
  name?: string;
  /** Table name used by the SQL format's INSERT statements. */
  tableName?: string;
}

export interface ExportResult {
  key: string;
  path: string;
  format: ExportFormat;
  bytes: number;
  rowCount: number;
  archived: string | null;
}

/** Whitelisted datasets, phrased against the analyst views (§21). */
export const DATASETS: Record<string, string> = {
  players: 'SELECT * FROM vw_player_season_stats',
  player_match_stats: 'SELECT * FROM vw_player_match_stats',
  player_percentiles: 'SELECT * FROM vw_player_percentiles',
  teams: 'SELECT * FROM vw_team_season_stats',
  team_match_stats: 'SELECT * FROM vw_team_match_stats',
  matches: 'SELECT * FROM vw_match_summary',
  events:
    'SELECT e.id, e."matchId" AS match_id, e."playerId" AS player_id, e."teamId" AS team_id, ' +
    'e.type, e.minute, e.second, e.x, e.y, e."endX" AS end_x, e."endY" AS end_y, e.outcome ' +
    'FROM events e',
  metrics: 'SELECT * FROM vw_player_per90',
  heatmap_zones: 'SELECT * FROM vw_heatmap_zone_activity',
  roles: 'SELECT * FROM vw_player_roles',
  similarity: 'SELECT * FROM vw_player_similarity',
  club_fit: 'SELECT * FROM vw_player_club_fit',
  tracking_aggregates:
    'SELECT ta.id, ta."trackingSessionId" AS tracking_session_id, ' +
    'p."fullName" AS player, t.name AS team, ta.phase, ' +
    'ta."avgX" AS avg_x, ta."avgY" AS avg_y, ta."distanceM" AS distance_m, ' +
    'ta."highSpeedDistanceM" AS high_speed_distance_m, ta."sprintCount" AS sprint_count, ' +
    'ta."maxSpeedMs" AS max_speed_ms, ta."teamWidthM" AS team_width_m, ' +
    'ta."teamDepthM" AS team_depth_m, ta.compactness, ta."analyticsVersion" AS analytics_version ' +
    'FROM tracking_aggregates ta ' +
    'LEFT JOIN players p ON p.id = ta."playerId" ' +
    'LEFT JOIN teams t ON t.id = ta."teamId"',
  shortlists:
    'SELECT s.name AS shortlist, p."fullName" AS player, sp.status, sp.priority, ' +
    'sp."scoutRating" AS scout_rating, sp.notes ' +
    'FROM shortlist_players sp ' +
    'JOIN shortlists s ON s.id = sp."shortlistId" ' +
    'JOIN players p ON p.id = sp."playerId"',
};

const timestamp = (): string =>
  new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');

const quoteSqlValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
};

export class ExportService {
  /** Resolve the request to a validated SELECT statement. */
  private statement(request: ExportRequest): string {
    if (request.dataset) {
      const sql = DATASETS[request.dataset];
      if (!sql) throw new Error(`Unknown dataset: ${request.dataset}`);
      return sql;
    }
    if (!request.sql) throw new Error('Either dataset or sql is required');
    return validateSelect(request.sql);
  }

  async run(request: ExportRequest): Promise<ExportResult> {
    const config = getConfig();
    const storage = getStorage();
    const statement = this.statement(request);
    const base = (request.name ?? request.dataset ?? 'export').replace(/[^\w.-]/g, '_');
    const key = `${base}-${timestamp()}.${request.format}`;

    const client = new Client({ connectionString: config.database.directUrl });
    await client.connect();

    try {
      await client.query('BEGIN READ ONLY');

      let contents: string;
      let rowCount: number;

      if (request.format === 'csv') {
        const result = await client.query({ text: statement, rowMode: 'array' });
        const columns = result.fields.map((field) => field.name);
        const lines = [columns.map(csvCell).join(',')];
        for (const row of result.rows as unknown[][]) {
          lines.push(row.map(csvCell).join(','));
        }
        contents = `${lines.join('\n')}\n`;
        rowCount = result.rows.length;
      } else if (request.format === 'json') {
        const result = await client.query(statement);
        contents = `${JSON.stringify(result.rows, null, 2)}\n`;
        rowCount = result.rows.length;
      } else {
        const result = await client.query({ text: statement, rowMode: 'array' });
        const columns = result.fields.map((field) => field.name);
        const table = (request.tableName ?? request.dataset ?? 'scoutiq_export').replace(
          /[^\w]/g,
          '_',
        );

        const lines = [
          `-- ScoutIQ export ${new Date().toISOString()}`,
          `-- ${rowsLabel(result.rows.length)} from: ${statement.replace(/\s+/g, ' ').slice(0, 200)}`,
          '',
        ];
        for (const row of result.rows as unknown[][]) {
          lines.push(
            `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')}) ` +
              `VALUES (${row.map(quoteSqlValue).join(', ')});`,
          );
        }
        contents = `${lines.join('\n')}\n`;
        rowCount = result.rows.length;
      }

      await client.query('ROLLBACK');

      const path = await storage.write('exports', key, contents);
      const archived = await storage.archive('exports', key).catch(() => null);

      return {
        key,
        path,
        format: request.format,
        bytes: Buffer.byteLength(contents),
        rowCount,
        archived,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const rowsLabel = (count: number): string => `${count} ${count === 1 ? 'row' : 'rows'}`;
