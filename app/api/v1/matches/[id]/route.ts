import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { apiError, json, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

/** Match page payload (§40): summary, team metrics, lineups, shots. */
export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
      season: { include: { competition: { select: { name: true } } } },
      venue: { select: { name: true } },
      officials: true,
      matchTeams: true,
      periods: true,
    },
  });
  if (!match) return apiError(404, 'not_found');

  const [teamMetrics, appearances, playerMetrics, shots, substitutions] = await Promise.all([
    prisma.teamMatchMetric.findMany({
      where: { matchId: id, analyticsVersion: ANALYTICS_VERSION },
    }),
    prisma.playerMatch.findMany({
      where: { matchId: id },
      include: {
        player: { select: { id: true, fullName: true, positionGroup: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: [{ isStarter: 'desc' }, { minutesPlayed: 'desc' }],
    }),
    prisma.playerMatchMetric.findMany({
      where: { matchId: id, analyticsVersion: ANALYTICS_VERSION },
    }),
    prisma.event.findMany({
      where: { matchId: id, type: 'SHOT', x: { not: null } },
      include: {
        shot: true,
        player: { select: { id: true, fullName: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { timestampMs: 'asc' },
    }),
    prisma.substitution.findMany({
      where: { matchId: id },
      include: {
        playerIn: { select: { id: true, fullName: true } },
        playerOut: { select: { id: true, fullName: true } },
      },
      orderBy: { minute: 'asc' },
    }),
  ]);

  const metricByPlayer = new Map(playerMetrics.map((metric) => [metric.playerId, metric]));

  return json({
    match: {
      id: match.id,
      kickoffAt: match.kickoffAt,
      status: match.status,
      competition: match.season.competition.name,
      season: match.season.seasonName,
      competitionSeasonId: match.competitionSeasonId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      venue: match.venue?.name ?? null,
      attendance: match.attendance,
      matchweek: match.matchweek,
      officials: match.officials,
      formations: match.matchTeams.map((team) => ({
        teamId: team.teamId,
        isHome: team.isHome,
        formation: team.formation,
      })),
      isDemo: match.isDemo,
    },
    teamMetrics,
    lineups: appearances.map((appearance) => ({
      playerId: appearance.playerId,
      name: appearance.player.fullName,
      positionGroup: appearance.player.positionGroup,
      team: appearance.team,
      position: appearance.position,
      shirtNumber: appearance.shirtNumber,
      isStarter: appearance.isStarter,
      minutesPlayed: appearance.minutesPlayed,
      metrics: metricByPlayer.get(appearance.playerId) ?? null,
    })),
    shots: shots.map((shot) => ({
      id: shot.id,
      minute: shot.minute,
      second: shot.second,
      x: shot.x,
      y: shot.y,
      player: shot.player,
      team: shot.team,
      xg: shot.shot?.xg ?? 0,
      isGoal: shot.shot?.isGoal ?? false,
      onTarget: shot.shot?.onTarget ?? false,
      bodyPart: shot.shot?.bodyPart ?? null,
      isPenalty: shot.shot?.isPenalty ?? false,
    })),
    substitutions,
  });
});
