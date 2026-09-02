import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';
import { SearchService } from '@/server/services/search.service';

const querySchema = z.object({
  q: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** Global fuzzy search (§46). */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  return json(await new SearchService().globalSearch(query.q, query.limit));
});
