import { z } from 'zod';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { FIT_MODEL_NOTE } from '@/analytics/club-fit';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';

const querySchema = z.object({
  playerId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const rows = await prisma.playerFitScore.findMany({
    where: {
      analyticsVersion: ANALYTICS_VERSION,
      ...(query.playerId ? { playerId: query.playerId } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
    },
    include: {
      player: { select: { id: true, fullName: true, positionGroup: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { fitScore: 'desc' },
    take: query.limit,
  });

  // The disclaimer travels with the data, not just with the UI (§32).
  return json({ note: FIT_MODEL_NOTE, items: rows });
});
