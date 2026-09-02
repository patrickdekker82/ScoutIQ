import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';
import { networkService } from '@/server/services/network.service';

const querySchema = z.object({
  matchId: z.string().uuid(),
  teamId: z.string().uuid(),
  period: z.enum(['full', 'first', 'second']).default('full'),
  possessionOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  minPasses: z.coerce.number().int().min(1).max(20).default(2),
});

/** Passing network for one team in one match (§38). */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  return json(await networkService.passingNetwork(query));
});
