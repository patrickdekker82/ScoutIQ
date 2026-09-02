import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, route } from '@/server/http';

/** Role definitions as data (§28, §84) - editable without a redeploy. */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);

  const roles = await prisma.playerRole.findMany({
    include: { requirements: { orderBy: { weight: 'desc' } }, _count: { select: { scores: true } } },
    orderBy: [{ positionGroup: 'asc' }, { name: 'asc' }],
  });

  return json(roles);
});
