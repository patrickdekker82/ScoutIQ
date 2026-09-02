import { z } from 'zod';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';

const querySchema = z.object({
  playerId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const rows = await prisma.playerSimilarity.findMany({
    where: { playerId: query.playerId, analyticsVersion: ANALYTICS_VERSION },
    include: {
      comparison: { select: { id: true, fullName: true, primaryPosition: true, positionGroup: true } },
    },
    orderBy: { similarity: 'desc' },
    take: query.limit,
  });

  return json(rows);
});
