import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { apiError, json, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

/**
 * Full player profile (§42): identity, metrics, percentiles, DNA, roles,
 * similar players, club fit, notes - everything the player page needs, with
 * data-quality attached so nothing is shown without its sample size (§54).
 */
export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;

  const player = await prisma.player.findUnique({
    where: { id },
    include: {
      country: { select: { name: true } },
      memberships: {
        where: { endDate: null },
        include: { team: { select: { id: true, name: true } } },
        take: 1,
      },
      positions: { orderBy: { minutes: 'desc' }, take: 3 },
    },
  });

  if (!player) return apiError(404, 'not_found');

  const seasonMetrics = await prisma.playerSeasonMetric.findMany({
    where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
    include: {
      season: { include: { competition: { select: { name: true } } } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { minutes: 'desc' },
  });

  const current = seasonMetrics[0] ?? null;

  const [percentiles, style, roles, similar, fits, notes, ratings, shortlists] = await Promise.all([
    current
      ? prisma.$queryRaw<{ metric_key: string; value: number; percentile: number; z_score: number; population_size: number }[]>`
          SELECT metric_key, value, percentile, z_score, population_size
          FROM vw_player_percentiles
          WHERE player_id = ${id}
            AND competition_season_id = ${current.competitionSeasonId}
            AND analytics_version = ${ANALYTICS_VERSION}
          ORDER BY percentile DESC
        `
      : Promise.resolve([]),
    current
      ? prisma.playerStyleProfile.findFirst({
          where: {
            playerId: id,
            competitionSeasonId: current.competitionSeasonId,
            analyticsVersion: ANALYTICS_VERSION,
          },
        })
      : Promise.resolve(null),
    prisma.playerRoleScore.findMany({
      where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { role: { select: { key: true, name: true, description: true } } },
      orderBy: { score: 'desc' },
      take: 8,
    }),
    prisma.playerSimilarity.findMany({
      where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
      include: {
        comparison: {
          select: {
            id: true,
            fullName: true,
            primaryPosition: true,
            memberships: {
              where: { endDate: null },
              include: { team: { select: { name: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { similarity: 'desc' },
      take: 10,
    }),
    prisma.playerFitScore.findMany({
      where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { fitScore: 'desc' },
      take: 10,
    }),
    prisma.scoutingNote.findMany({
      where: { playerId: id },
      include: { author: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.scoutRating.findMany({
      where: { playerId: id },
      include: { author: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.shortlistPlayer.findMany({
      where: { playerId: id },
      include: { shortlist: { select: { id: true, name: true } } },
    }),
  ]);

  return json({
    player: {
      id: player.id,
      fullName: player.fullName,
      knownAs: player.knownAs,
      dateOfBirth: player.dateOfBirth,
      age: player.dateOfBirth
        ? Math.floor((Date.now() - player.dateOfBirth.getTime()) / (365.25 * 864e5))
        : null,
      nationality: player.country?.name ?? null,
      heightCm: player.heightCm,
      weightKg: player.weightKg,
      preferredFoot: player.preferredFoot,
      position: player.primaryPosition,
      positionGroup: player.positionGroup,
      team: player.memberships[0]?.team ?? null,
      positions: player.positions,
      isDemo: player.isDemo,
    },
    seasons: seasonMetrics.map((metric) => ({
      competitionSeasonId: metric.competitionSeasonId,
      season: metric.season.seasonName,
      competition: metric.season.competition.name,
      team: metric.team,
      minutes: metric.minutes,
      matches: metric.matches,
      confidence: metric.confidence,
    })),
    current,
    percentiles: percentiles.map((entry) => ({
      metricKey: entry.metric_key,
      value: Number(entry.value),
      percentile: Number(entry.percentile),
      zScore: Number(entry.z_score),
      populationSize: Number(entry.population_size),
    })),
    dna: style?.dna ?? null,
    dnaInputs: style?.inputs ?? null,
    dnaConfidence: style?.confidence ?? null,
    referencePopulation: style?.referencePopulation ?? null,
    roles: roles.map((role) => ({
      key: role.role.key,
      name: role.role.name,
      description: role.role.description,
      score: role.score,
      isPrimary: role.isPrimary,
      confidence: role.confidence,
      breakdown: role.breakdown,
    })),
    similar: similar.map((entry) => ({
      playerId: entry.comparisonPlayerId,
      name: entry.comparison.fullName,
      position: entry.comparison.primaryPosition,
      team: entry.comparison.memberships[0]?.team.name ?? null,
      similarity: entry.similarity,
      breakdown: entry.breakdown,
    })),
    clubFit: fits.map((fit) => ({
      teamId: fit.teamId,
      team: fit.team.name,
      fitScore: fit.fitScore,
      breakdown: fit.breakdown,
    })),
    notes: notes.map((note) => ({
      id: note.id,
      author: note.author.displayName,
      minute: note.minute,
      body: note.body,
      tags: note.tags,
      createdAt: note.createdAt,
    })),
    ratings,
    shortlists: shortlists.map((entry) => ({
      shortlistId: entry.shortlistId,
      name: entry.shortlist.name,
      status: entry.status,
      priority: entry.priority,
    })),
    quality: current
      ? {
          minutes: current.minutes,
          matches: current.matches,
          confidence: current.confidence,
          analyticsVersion: current.analyticsVersion,
        }
      : null,
  });
});
