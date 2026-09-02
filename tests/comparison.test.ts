import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ComparisonService } from '@/server/services/comparison.service';

/**
 * Player comparison (§43).
 *
 * The rule under test is honesty about populations: comparing percentiles from
 * two different competition seasons is not a like-for-like comparison, and the
 * result has to say so.
 */

const ID = {
  a: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  b: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  c: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
};

interface Seed {
  id: string;
  fullName: string;
  competitionSeasonId: string;
  positionGroup: string;
  metrics?: Record<string, number>;
  percentiles?: { metric_key: string; percentile: number }[];
  dna?: Record<string, number>;
}

const stub = (seeds: Seed[]) => {
  const byId = new Map(seeds.map((seed) => [seed.id, seed]));

  return {
    player: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .map((id) => byId.get(id))
          .filter((seed): seed is Seed => seed !== undefined)
          .map((seed) => ({
            id: seed.id,
            fullName: seed.fullName,
            isDemo: false,
            primaryPosition: 'CM',
            positionGroup: seed.positionGroup,
            dateOfBirth: new Date('2000-01-01T00:00:00Z'),
            preferredFoot: 'RIGHT',
            heightCm: 180,
            country: { name: 'Netherlands' },
            memberships: [{ team: { name: 'Stub FC' } }],
          })),
    },
    playerSeasonMetric: {
      findFirst: async ({ where }: { where: { playerId: string } }) => {
        const seed = byId.get(where.playerId);
        if (!seed) return null;
        return {
          competitionSeasonId: seed.competitionSeasonId,
          positionGroup: seed.positionGroup,
          minutes: 1800,
          matches: 20,
          confidence: 'HIGH',
          season: { seasonName: '2025/26', competition: { name: 'Eredivisie' } },
          team: { name: 'Stub FC' },
          ...(seed.metrics ?? {}),
        };
      },
    },
    playerStyleProfile: {
      findFirst: async ({ where }: { where: { playerId: string } }) => {
        const seed = byId.get(where.playerId);
        return seed?.dna ? { dna: seed.dna } : null;
      },
    },
    playerRoleScore: { findMany: async () => [] },
    playerFitScore: { findMany: async () => [] },
    $queryRaw: async (_strings: TemplateStringsArray, playerId: string) => {
      const seed = byId.get(playerId);
      return (seed?.percentiles ?? []).map((entry) => ({
        player_id: playerId,
        metric_key: entry.metric_key,
        percentile: entry.percentile,
        population_size: 120,
      }));
    },
  } as unknown as PrismaClient;
};

describe('comparePlayers', () => {
  it('refuses fewer than two and more than five players (§43)', async () => {
    const service = new ComparisonService(stub([]));
    await expect(service.comparePlayers([ID.a])).rejects.toThrow('at least two');
    await expect(
      service.comparePlayers(['1', '2', '3', '4', '5', '6']),
    ).rejects.toThrow('five players');
  });

  it('keeps the caller order, so the table reads as asked for', async () => {
    const service = new ComparisonService(
      stub([
        { id: ID.a, fullName: 'Ann Archer', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
        { id: ID.b, fullName: 'Bo Berg', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
      ]),
    );

    const result = await service.comparePlayers([ID.b, ID.a]);
    expect(result.players.map((player) => player.fullName)).toEqual(['Bo Berg', 'Ann Archer']);
  });

  it('flags a shared population when season and position group match', async () => {
    const service = new ComparisonService(
      stub([
        { id: ID.a, fullName: 'Ann Archer', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
        { id: ID.b, fullName: 'Bo Berg', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
      ]),
    );

    expect((await service.comparePlayers([ID.a, ID.b])).sharedPopulation).toBe(true);
  });

  it('flags different populations when the seasons differ', async () => {
    const service = new ComparisonService(
      stub([
        { id: ID.a, fullName: 'Ann Archer', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
        { id: ID.b, fullName: 'Bo Berg', competitionSeasonId: 's2', positionGroup: 'MIDFIELDER' },
      ]),
    );

    expect((await service.comparePlayers([ID.a, ID.b])).sharedPopulation).toBe(false);
  });

  it('flags different populations when the position groups differ', async () => {
    const service = new ComparisonService(
      stub([
        { id: ID.a, fullName: 'Ann Archer', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
        { id: ID.b, fullName: 'Bo Berg', competitionSeasonId: 's1', positionGroup: 'DEFENDER' },
      ]),
    );

    expect((await service.comparePlayers([ID.a, ID.b])).sharedPopulation).toBe(false);
  });

  it('drops metric rows where nobody has a value', async () => {
    const service = new ComparisonService(
      stub([
        {
          id: ID.a,
          fullName: 'Ann Archer',
          competitionSeasonId: 's1',
          positionGroup: 'MIDFIELDER',
          metrics: { goalsP90: 0.4, xgP90: 0 },
        },
        {
          id: ID.b,
          fullName: 'Bo Berg',
          competitionSeasonId: 's1',
          positionGroup: 'MIDFIELDER',
          metrics: { goalsP90: 0, xgP90: 0 },
        },
      ]),
    );

    const result = await service.comparePlayers([ID.a, ID.b]);
    expect(result.metricKeys).toContain('goalsP90');
    expect(result.metricKeys).not.toContain('xgP90');
  });

  it('splits strengths and weaknesses at the 70th and 30th percentile', async () => {
    const service = new ComparisonService(
      stub([
        {
          id: ID.a,
          fullName: 'Ann Archer',
          competitionSeasonId: 's1',
          positionGroup: 'MIDFIELDER',
          // The view emits snake_case; the service must re-key it.
          percentiles: [
            { metric_key: 'goals_p90', percentile: 92 },
            { metric_key: 'pass_accuracy', percentile: 55 },
            { metric_key: 'tackles_p90', percentile: 12 },
          ],
        },
        { id: ID.b, fullName: 'Bo Berg', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
      ]),
    );

    const [ann] = (await service.comparePlayers([ID.a, ID.b])).players;

    expect(ann?.strengths.map((entry) => entry.metricKey)).toEqual(['goalsP90']);
    expect(ann?.weaknesses.map((entry) => entry.metricKey)).toEqual(['tacklesP90']);
    // Re-keyed so a percentile can be looked up by the metric column it ranks.
    expect(ann?.percentiles.passAccuracy?.percentile).toBe(55);
    expect(ann?.percentiles).not.toHaveProperty('pass_accuracy');
  });

  it('collects every DNA category present for at least one player', async () => {
    const service = new ComparisonService(
      stub([
        {
          id: ID.a,
          fullName: 'Ann Archer',
          competitionSeasonId: 's1',
          positionGroup: 'MIDFIELDER',
          dna: { Passing: 70, Pressing: 40 },
        },
        {
          id: ID.b,
          fullName: 'Bo Berg',
          competitionSeasonId: 's1',
          positionGroup: 'MIDFIELDER',
          dna: { Passing: 55, Aerial: 80 },
        },
      ]),
    );

    const result = await service.comparePlayers([ID.a, ID.b]);
    expect(result.dnaCategories).toEqual(['Passing', 'Pressing', 'Aerial']);
  });

  it('ignores a duplicate id rather than comparing a player with themselves', async () => {
    const service = new ComparisonService(
      stub([
        { id: ID.a, fullName: 'Ann Archer', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
        { id: ID.b, fullName: 'Bo Berg', competitionSeasonId: 's1', positionGroup: 'MIDFIELDER' },
      ]),
    );

    const result = await service.comparePlayers([ID.a, ID.a, ID.b]);
    expect(result.players).toHaveLength(2);
  });
});
