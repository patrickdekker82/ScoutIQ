import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;

  const appearances = await prisma.playerMatch.findMany({
    where: { playerId: id },
    include: {
      match: {
        include: {
          homeTeam: { select: { id: true, name: true } },
          awayTeam: { select: { id: true, name: true } },
          season: { include: { competition: { select: { name: true } } } },
        },
      },
    },
    orderBy: { match: { kickoffAt: 'desc' } },
    take: 100,
  });

  const metrics = await prisma.playerMatchMetric.findMany({
    where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
  });
  const byMatch = new Map(metrics.map((metric) => [metric.matchId, metric]));

  return json(
    appearances.map((appearance) => ({
      matchId: appearance.matchId,
      kickoffAt: appearance.match.kickoffAt,
      competition: appearance.match.season.competition.name,
      season: appearance.match.season.seasonName,
      homeTeam: appearance.match.homeTeam,
      awayTeam: appearance.match.awayTeam,
      score:
        appearance.match.homeScore !== null && appearance.match.awayScore !== null
          ? `${appearance.match.homeScore}-${appearance.match.awayScore}`
          : null,
      position: appearance.position,
      isStarter: appearance.isStarter,
      minutesPlayed: appearance.minutesPlayed,
      metrics: byMatch.get(appearance.matchId) ?? null,
    })),
  );
});
