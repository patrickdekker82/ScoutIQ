import { DATASETS, ExportService, type ExportFormat } from '@/server/services/export.service';
import { disconnectPrisma } from '@/db/client';

/**
 * Export CLI (§9, §78).
 *
 *   npm run db:export -- --dataset players --format csv
 *   npm run db:export -- --sql "SELECT * FROM vw_player_season_stats LIMIT 100" --format json
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const dataset = read('--dataset');
  const sql = read('--sql');
  const format = (read('--format') ?? 'csv') as ExportFormat;
  const name = read('--name');

  if (!dataset && !sql) {
    process.stdout.write(
      'Usage: npm run db:export -- --dataset <name> --format csv|json|sql\n\n' +
        `Datasets: ${Object.keys(DATASETS).join(', ')}\n`,
    );
    return;
  }

  if (!['csv', 'json', 'sql'].includes(format)) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const result = await new ExportService().run({
    ...(dataset ? { dataset } : {}),
    ...(sql ? { sql } : {}),
    ...(name ? { name } : {}),
    format,
  });

  process.stdout.write(
    `Exported ${result.rowCount} rows (${(result.bytes / 1024).toFixed(1)} KB)\n` +
      `  ${result.path}\n` +
      (result.archived ? `  archived: ${result.archived}\n` : ''),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
