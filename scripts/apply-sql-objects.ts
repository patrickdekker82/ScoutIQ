import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { getConfig } from '@/lib/config';

/**
 * (Re-)apply the SQL views and materialized views (§21, §22).
 *
 * The migration that creates them is the single source of truth; this script
 * runs the very same file, so views can be refreshed during development
 * without a database reset and can never drift from what a fresh install gets.
 */
const MIGRATION = 'prisma/migrations/20260101000100_sql_objects/migration.sql';

async function main(): Promise<void> {
  const sql = await readFile(path.resolve(process.cwd(), MIGRATION), 'utf8');
  const client = new Client({ connectionString: getConfig().database.directUrl });

  await client.connect();
  try {
    await client.query(sql);
    process.stdout.write(`Applied ${MIGRATION}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
