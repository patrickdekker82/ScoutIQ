import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { apiError, json, route } from '@/server/http';
import { ANALYTICS_VERSION } from '@/analytics/version';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;

  const shortlist = await prisma.shortlist.findUnique({
    where: { id },
    include: {
      owner: { select: { displayName: true } },
      players: {
        include: {
          player: {
            select: {
              id: true,
              fullName: true,
              primaryPosition: true,
              positionGroup: true,
              dateOfBirth: true,
              seasonMetrics: {
                where: { analyticsVersion: ANALYTICS_VERSION },
                orderBy: { minutes: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ priority: 'asc' }, { addedAt: 'desc' }],
      },
      notes: {
        include: { author: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!shortlist) return apiError(404, 'not_found');
  return json(shortlist);
});

export const DELETE = route(async (request: Request, context: Context) => {
  const user = await requirePermission('shortlists:write', request);
  const { id } = await context.params;

  const shortlist = await prisma.shortlist.findUnique({ where: { id } });
  if (!shortlist) return apiError(404, 'not_found');
  if (shortlist.ownerId !== user.id && user.role !== 'ADMIN') {
    return apiError(403, 'forbidden', { message: 'Only the owner may delete this shortlist' });
  }

  await prisma.shortlist.delete({ where: { id } });
  return json({ ok: true });
});
