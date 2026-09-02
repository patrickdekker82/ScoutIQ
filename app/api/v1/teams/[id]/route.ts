import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { apiError, json, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

/** Club page payload (§41): squad, style, season metrics, matches. */
export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: { country: { select: { name: true } } },
  });
  if (!team) return apiError(404, 'not_found');

  const [style, seasonMetrics, squad, matches, matchMetrics] = await Promise.all([
    prisma.teamStyleProfile.findFirst({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { season: { include: { competition: { select: { name: true } } } } },
      orderBy: { computedAt: 'desc' },
    }),
    prisma.teamSeasonMetric.findMany({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { season: { include: { competition: { select: { name: true } } } } },
      orderBy: { matches: 'desc' },
    }),
    prisma.playerSeasonMetric.findMany({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
      include: {
        player: {
          select: {
            id: true,
            fullName: true,
            primaryPosition: true,
            positionGroup: true,
            dateOfBirth: true,
          },
        },
      },
      orderBy: { minutes: 'desc' },
    }),
    prisma.match.findMany({
      where: { OR: [{ homeTeamId: id }, { awayTeamId: id }] },
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        season: { include: { competition: { select: { name: true } } } },
      },
      orderBy: { kickoffAt: 'desc' },
      take: 40,
    }),
    prisma.teamMatchMetric.findMany({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
    }),
  ]);

  const metricByMatch = new Map(matchMetrics.map((metric) => [metric.matchId, metric]));

  return json({
    team: {
      id: team.id,
      name: team.name,
      shortName: team.shortName,
      country: team.country?.name ?? null,
      founded: team.founded,
      isDemo: team.isDemo,
    },
    style: style
      ? {
          competitionSeasonId: style.competitionSeasonId,
          season: style.season.seasonName,
          competition: style.season.competition.name,
          dimensions: style.style,
          inputs: style.inputs,
          confidence: style.confidence,
          sampleMatches: style.sampleMatches,
        }
      : null,
    seasons: seasonMetrics.map((metric) => ({
      competitionSeasonId: metric.competitionSeasonId,
      competition: metric.season.competition.name,
      season: metric.season.seasonName,
      metrics: metric,
    })),
    squad: squad.map((entry) => ({
      playerId: entry.playerId,
      name: entry.player.fullName,
      position: entry.player.primaryPosition,
      positionGroup: entry.player.positionGroup,
      age: entry.player.dateOfBirth
        ? Math.floor((Date.now() - entry.player.dateOfBirth.getTime()) / (365.25 * 864e5))
        : null,
      minutes: entry.minutes,
      matches: entry.matches,
      goalsP90: entry.goalsP90,
      xgP90: entry.xgP90,
      xaP90: entry.xaP90,
      progressivePassesP90: entry.progressivePassesP90,
      confidence: entry.confidence,
    })),
    matches: matches.map((match) => ({
      id: match.id,
      kickoffAt: match.kickoffAt,
      competition: match.season.competition.name,
      season: match.season.seasonName,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      metrics: metricByMatch.get(match.id) ?? null,
    })),
  });
});
