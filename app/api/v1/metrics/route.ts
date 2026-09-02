import { z } from 'zod';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';
import { SEARCHABLE_METRICS } from '@/server/services/search.service';

const querySchema = z.object({
  competitionSeasonId: z.string().uuid().optional(),
  positionGroup: z.enum(['GK', 'DF', 'MF', 'FW']).optional(),
  metricKey: z.string().optional(),
  minMinutes: z.coerce.number().int().min(0).default(450),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Percentile leaderboard straight from the materialized view (§22, §26). */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  if (!query.metricKey) {
    return json({
      availableMetrics: SEARCHABLE_METRICS,
      analyticsVersion: ANALYTICS_VERSION,
    });
  }

  const rows = await prisma.$queryRaw<
    {
      player_id: string;
      player_name: string;
      position_group: string;
      value: number;
      percentile: number;
      z_score: number;
      population_size: number;
    }[]
  >`
    SELECT player_id, player_name, position_group, value, percentile, z_score, population_size
    FROM mv_player_percentiles
    WHERE metric_key = ${toSnake(query.metricKey)}
      AND analytics_version = ${ANALYTICS_VERSION}
      AND minutes >= ${query.minMinutes}
      AND (${query.competitionSeasonId ?? null}::text IS NULL
           OR competition_season_id = ${query.competitionSeasonId ?? null})
      AND (${query.positionGroup ?? null}::text IS NULL
           OR position_group = ${query.positionGroup ?? null})
    ORDER BY percentile DESC
    LIMIT ${query.limit}
  `;

  return json({ metricKey: query.metricKey, analyticsVersion: ANALYTICS_VERSION, items: rows });
});

/** The views expose snake_case metric keys; the API speaks camelCase. */
const toSnake = (value: string): string =>
  value.replace(/([A-Z])/g, '_$1').replace(/P90$/i, '_p90').toLowerCase().replace(/__/g, '_');
