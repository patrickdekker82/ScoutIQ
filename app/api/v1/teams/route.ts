import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, route } from '@/server/http';

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);

  const teams = await prisma.team.findMany({
    include: {
      country: { select: { name: true } },
      seasonMetrics: {
        where: { analyticsVersion: ANALYTICS_VERSION },
        orderBy: { matches: 'desc' },
        take: 1,
      },
      _count: { select: { memberships: true } },
    },
    orderBy: { name: 'asc' },
    take: 200,
  });

  return json(
    teams.map((team) => ({
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      country: team.country?.name ?? null,
      isDemo: team.isDemo,
      squadSize: team._count.memberships,
      metrics: team.seasonMetrics[0] ?? null,
    })),
  );
});
