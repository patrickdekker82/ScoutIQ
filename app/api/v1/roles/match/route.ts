import { MetricDirection } from '@prisma/client';
import { z } from 'zod';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { scoreRole } from '@/analytics/roles';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, parseBody, route } from '@/server/http';
import { SEARCHABLE_METRICS } from '@/server/services/search.service';

/**
 * Match players against a role definition (§29).
 *
 * The definition is scored live, before it is saved, so a scout can see who a
 * role picks out and adjust the weights until it picks out the right people.
 * Percentiles are taken within the competition season and position group, as
 * everywhere else - the population is never implicit (§26).
 */
const schema = z.object({
  positionGroup: z.enum(['GK', 'DF', 'MF', 'FW']),
  minMinutes: z.number().int().min(0).max(5000).default(450),
  requirements: z
    .array(
      z.object({
        metricKey: z.enum(SEARCHABLE_METRICS as unknown as [string, ...string[]]),
        weight: z.number().min(0.05).max(10),
        direction: z.nativeEnum(MetricDirection).default(MetricDirection.HIGHER_BETTER),
        minPercentile: z.number().min(0).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(15),
  competitionSeasonId: z.string().uuid().optional(),
  maxAge: z.number().int().min(14).max(50).optional(),
  minHeightCm: z.number().int().min(120).max(230).optional(),
  preferredFoot: z.enum(['LEFT', 'RIGHT', 'BOTH']).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const POST = route(async (request: Request) => {
  await requirePermission('analytics:run', request);
  const body = await parseBody(request, schema);

  // The percentile population is everyone in the same competition season and
  // position group who meets the minutes bar. The scouting filters below
  // (age, height, foot) narrow WHO IS LISTED, never who a player is measured
  // against - otherwise "top of the tall left-footers" would read as a league
  // rank (§26).
  const scope = {
    analyticsVersion: ANALYTICS_VERSION,
    positionGroup: body.positionGroup,
    minutes: { gte: body.minMinutes },
    ...(body.competitionSeasonId ? { competitionSeasonId: body.competitionSeasonId } : {}),
  };

  const population = await prisma.playerSeasonMetric.findMany({ where: scope });

  const candidates = await prisma.playerSeasonMetric.findMany({
    where: {
      ...scope,
      player: {
        ...(body.preferredFoot ? { preferredFoot: body.preferredFoot } : {}),
        ...(body.minHeightCm ? { heightCm: { gte: body.minHeightCm } } : {}),
        ...(body.maxAge
          ? {
              dateOfBirth: {
                gte: new Date(Date.now() - body.maxAge * 365.25 * 864e5),
              },
            }
          : {}),
      },
    },
    include: {
      player: {
        select: { id: true, fullName: true, primaryPosition: true, dateOfBirth: true },
      },
      team: { select: { name: true } },
      season: { include: { competition: { select: { name: true } } } },
    },
  });

  if (candidates.length === 0) {
    return json({
      population: population.length,
      candidates: 0,
      matches: [],
      note: 'No player meets those filters.',
    });
  }

  const populations = new Map<string, Map<string, number[]>>();
  for (const candidate of population) {
    let bySeason = populations.get(candidate.competitionSeasonId);
    if (!bySeason) {
      bySeason = new Map();
      populations.set(candidate.competitionSeasonId, bySeason);
    }
    const row = candidate as unknown as Record<string, unknown>;
    for (const requirement of body.requirements) {
      const value = row[requirement.metricKey];
      if (typeof value !== 'number') continue;
      const values = bySeason.get(requirement.metricKey) ?? [];
      values.push(value);
      bySeason.set(requirement.metricKey, values);
    }
  }

  const role = {
    key: 'draft',
    name: 'Draft role',
    minMinutes: body.minMinutes,
    requirements: body.requirements.map((requirement) => ({
      metricKey: requirement.metricKey,
      weight: requirement.weight,
      direction: requirement.direction,
      ...(requirement.minPercentile !== null && requirement.minPercentile !== undefined
        ? { minPercentile: requirement.minPercentile }
        : {}),
    })),
  };

  const scored = candidates.map((candidate) => {
    const row = candidate as unknown as Record<string, unknown>;
    const bySeason = populations.get(candidate.competitionSeasonId);

    const metrics = Object.fromEntries(
      body.requirements.map((requirement) => {
        const value = row[requirement.metricKey];
        return [
          requirement.metricKey,
          {
            value: typeof value === 'number' ? value : null,
            population: bySeason?.get(requirement.metricKey) ?? [],
          },
        ];
      }),
    );

    const result = scoreRole(role, { metrics, minutes: candidate.minutes });

    return {
      playerId: candidate.player.id,
      playerName: candidate.player.fullName,
      position: candidate.player.primaryPosition,
      age: candidate.player.dateOfBirth
        ? Math.floor((Date.now() - candidate.player.dateOfBirth.getTime()) / (365.25 * 864e5))
        : null,
      club: candidate.team?.name ?? null,
      season: `${candidate.season.competition.name} ${candidate.season.seasonName}`,
      minutes: candidate.minutes,
      confidence: candidate.confidence,
      score: result.score,
      coverage: result.coverage,
      breakdown: result.breakdown,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return json({
    /** Players a percentile is measured against. */
    population: population.length,
    /** Players who passed the scouting filters and were scored. */
    candidates: candidates.length,
    matches: scored.slice(0, body.limit),
  });
});
