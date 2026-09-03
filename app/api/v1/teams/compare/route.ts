import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { comparisonService } from '@/server/services/comparison.service';
import { apiError, json, parseQuery, route } from '@/server/http';

const querySchema = z.object({
  ids: z
    .string()
    .transform((value) => value.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(2).max(5)),
});

/** Club comparison, 2-5 clubs (§44). */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const comparison = await comparisonService.compareTeams(query.ids);
  if (comparison.clubs.length < 2) {
    return apiError(404, 'not_found', { message: 'At least two of those clubs do not exist.' });
  }

  return json(comparison);
});
