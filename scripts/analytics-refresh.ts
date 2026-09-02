import { disconnectPrisma } from '@/db/client';
import { AnalyticsService } from '@/server/services/analytics.service';

/**
 * Recompute analytics and refresh the materialized views (§22).
 *
 *   npm run analytics:refresh
 *   npm run analytics:refresh -- --season <competitionSeasonId>
 *   npm run analytics:refresh -- --views-only
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const seasonIndex = argv.indexOf('--season');
  const seasonId = seasonIndex >= 0 ? argv[seasonIndex + 1] : undefined;
  const viewsOnly = argv.includes('--views-only');

  const service = new AnalyticsService();

  if (viewsOnly) {
    const views = await service.refreshMaterializedViews();
    process.stdout.write(`Refreshed: ${views.join(', ')}\n`);
    return;
  }

  const seasons = seasonId
    ? [{ id: seasonId, name: seasonId, competition: '' }]
    : await service.knownSeasons();

  if (seasons.length === 0) {
    process.stdout.write('No seasons with match data found. Import something first.\n');
    return;
  }

  for (const season of seasons) {
    process.stdout.write(`\n${season.competition} ${season.name}\n`);
    const summary = await service.recomputeSeason(season.id, (message, progress) => {
      process.stdout.write(`\r  [${String(progress).padStart(3)}%] ${message.padEnd(50)}`);
    });

    process.stdout.write(
      `\r  Done in ${(summary.durationMs / 1000).toFixed(1)}s`.padEnd(60) +
        `\n    player match metrics: ${summary.playerMatchMetrics}\n` +
        `    player season metrics: ${summary.playerSeasonMetrics}\n` +
        `    team season metrics:   ${summary.teamSeasonMetrics}\n` +
        `    DNA profiles:          ${summary.dnaProfiles}\n` +
        `    role scores:           ${summary.roleScores}\n` +
        `    similarities:          ${summary.similarities}\n` +
        `    team styles:           ${summary.teamStyles}\n` +
        `    club fits:             ${summary.fitScores}\n`,
    );
  }

  const views = await service.refreshMaterializedViews();
  process.stdout.write(`\nRefreshed materialized views: ${views.join(', ')}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
