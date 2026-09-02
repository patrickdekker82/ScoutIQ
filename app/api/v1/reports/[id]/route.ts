import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { apiError, json, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;

  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      author: { select: { displayName: true } },
      player: { select: { id: true, fullName: true } },
      versions: {
        orderBy: { version: 'desc' },
        include: { blocks: { orderBy: { order: 'asc' } } },
      },
    },
  });

  if (!report) return apiError(404, 'not_found');
  return json(report);
});
