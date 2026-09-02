import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';
import { SearchService, SEARCHABLE_METRICS } from '@/server/services/search.service';

/** Accepts `?positionGroups=MF,FW` and repeated `?positionGroups=` params. */
const csvList: z.ZodType<string[], z.ZodTypeDef, unknown> = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(',')).map((entry) => entry.trim()).filter(Boolean),
  );

const querySchema = z.object({
  name: z.string().optional(),
  minAge: z.coerce.number().int().optional(),
  maxAge: z.coerce.number().int().optional(),
  nationality: z.string().optional(),
  positionGroups: csvList.optional(),
  preferredFoot: z.enum(['LEFT', 'RIGHT', 'BOTH', 'UNKNOWN']).optional(),
  minHeightCm: z.coerce.number().int().optional(),
  maxHeightCm: z.coerce.number().int().optional(),
  teamId: z.string().uuid().optional(),
  competitionSeasonId: z.string().uuid().optional(),
  minMinutes: z.coerce.number().int().optional(),
  /// Repeatable metric filter: metric:operator:value[:value2]
  metric: z.union([z.string(), z.array(z.string())]).optional(),
  sortBy: z.string().optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  includeDemo: z.enum(['true', 'false']).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

const OPERATORS = ['gt', 'lt', 'eq', 'gte', 'lte', 'between', 'percentile'] as const;

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const rawMetrics = query.metric
    ? Array.isArray(query.metric)
      ? query.metric
      : [query.metric]
    : [];

  const metrics = rawMetrics
    .map((entry) => {
      const [metricKey, operator, value, value2] = entry.split(':');
      if (!metricKey || !operator || value === undefined) return null;
      if (!(OPERATORS as readonly string[]).includes(operator)) return null;
      if (!(SEARCHABLE_METRICS as readonly string[]).includes(metricKey)) return null;

      return {
        metricKey,
        operator: operator as (typeof OPERATORS)[number],
        value: Number(value),
        ...(value2 !== undefined ? { value2: Number(value2) } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const { metric, includeDemo, ...rest } = query;
  void metric;

  const result = await new SearchService().searchPlayers({
    ...rest,
    ...(metrics.length > 0 ? { metrics } : {}),
    ...(includeDemo !== undefined ? { includeDemo: includeDemo === 'true' } : {}),
  });

  return json({
    total: result.total,
    take: query.take ?? 50,
    skip: query.skip ?? 0,
    items: result.rows,
  });
});
