import { describe, expect, it } from 'vitest';
import { computeDna, DNA_CATEGORIES, type MetricInputs } from '@/analytics/dna';
import { computeClubFit, FIT_MODEL_NOTE } from '@/analytics/club-fit';
import { rankRoles, scoreRole, SYSTEM_ROLES } from '@/analytics/roles';
import { findSimilarPlayers, weightedCosineSimilarity } from '@/analytics/similarity';
import { computeTeamStyle, STYLE_DIMENSIONS } from '@/analytics/team-style';

const inputs = (values: Record<string, number | null>, population: number[]): MetricInputs =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value, population }]),
  );

/** Player DNA (§27) and its transparency requirement (§85). */
describe('computeDna', () => {
  it('scores categories from percentiles and reports its inputs', () => {
    const result = computeDna(
      inputs(
        {
          passesP90: 60,
          passAccuracy: 0.9,
          longPassesP90: 5,
          passesFinalThirdP90: 8,
        },
        [10, 20, 30, 40, 50],
      ),
      'MF',
    );

    const passing = result.categories.find((entry) => entry.category === 'Passing');
    expect(passing?.score).toBeGreaterThan(0);
    expect(passing?.inputs.length).toBeGreaterThan(0);
    // Every contribution names its metric, percentile and weight.
    expect(passing?.inputs[0]).toMatchObject({
      metricKey: expect.any(String),
      percentile: expect.any(Number),
      weight: expect.any(Number),
    });
  });

  it('reports coverage instead of scoring absent data as zero', () => {
    const result = computeDna(
      inputs({ passesP90: 50, passAccuracy: null, longPassesP90: null, passesFinalThirdP90: null }, [
        10, 20, 30,
      ]),
      'MF',
    );

    const passing = result.categories.find((entry) => entry.category === 'Passing');
    expect(passing?.coverage).toBeLessThan(1);
    expect(passing?.coverage).toBeGreaterThan(0);
  });

  it('produces a style vector for similarity', () => {
    const result = computeDna(inputs({ passesP90: 40 }, [10, 20, 30, 40]), 'MF');
    expect(result.styleVector.passesP90).toBe(100);
  });

  it('covers all eleven categories', () => {
    expect(DNA_CATEGORIES).toHaveLength(11);
  });
});

/** Role engine (§28) with definitions as data (§84). */
describe('roles', () => {
  it('ships the nineteen system roles', () => {
    expect(SYSTEM_ROLES).toHaveLength(19);
    expect(new Set(SYSTEM_ROLES.map((role) => role.key)).size).toBe(19);
  });

  it('every requirement weight set sums to roughly one', () => {
    for (const role of SYSTEM_ROLES) {
      const total = role.requirements.reduce((sum, entry) => sum + entry.weight, 0);
      expect(total).toBeGreaterThan(0.95);
      expect(total).toBeLessThan(1.05);
    }
  });

  it('scores a role and explains the score', () => {
    const role = SYSTEM_ROLES.find((entry) => entry.key === 'ball-winning-6')!;
    const result = scoreRole(role, {
      minutes: 1800,
      metrics: {
        tacklesP90: { value: 4, population: [1, 2, 3, 4] },
        interceptionsP90: { value: 3, population: [1, 2, 3] },
        recoveriesP90: { value: 8, population: [4, 6, 8] },
        defensiveDuelWinRate: { value: 0.7, population: [0.4, 0.5, 0.7] },
        pressuresP90: { value: 20, population: [10, 15, 20] },
        passAccuracy: { value: 0.85, population: [0.7, 0.8, 0.85] },
      },
    });

    expect(result.score).toBe(100);
    expect(result.coverage).toBe(1);
    expect(result.meetsMinutes).toBe(true);
    expect(result.breakdown).toHaveLength(6);
  });

  it('ranks roles and reports confidence honestly on thin data', () => {
    const midfieldRoles = SYSTEM_ROLES.filter((role) => role.positionGroup === 'MF');
    const profile = rankRoles(midfieldRoles, {
      minutes: 90,
      metrics: { tacklesP90: { value: 5, population: [1, 2, 3, 4, 5] } },
    });

    expect(profile.primary).not.toBeNull();
    expect(profile.secondary.length).toBeGreaterThan(0);
    // One metric out of many: confidence must not look certain.
    expect(profile.confidence).toBeLessThan(0.6);
    expect(profile.primary?.meetsMinutes).toBe(false);
  });
});

/** Similarity (§30). */
describe('weightedCosineSimilarity', () => {
  it('scores identical profiles as identical', () => {
    const vector = { a: 80, b: 20, c: 55 };
    expect(weightedCosineSimilarity(vector, { ...vector }).similarity).toBe(1);
  });

  it('separates opposite profiles from similar ones', () => {
    const subject = { a: 90, b: 10 };
    const alike = { a: 85, b: 15 };
    const opposite = { a: 10, b: 90 };

    const near = weightedCosineSimilarity(subject, alike).similarity;
    const far = weightedCosineSimilarity(subject, opposite).similarity;

    expect(near).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(0.1);
  });

  it('explains where two players agree and differ', () => {
    const result = weightedCosineSimilarity(
      { passing: 90, pressing: 20, dribbling: 50 },
      { passing: 88, pressing: 85, dribbling: 52 },
    );

    expect(result.differences[0]?.metricKey).toBe('pressing');
    expect(result.agreements[0]?.difference).toBeLessThan(5);
  });

  it('returns 0 when the vectors share no dimensions', () => {
    expect(weightedCosineSimilarity({ a: 1 }, { b: 2 }).similarity).toBe(0);
  });

  it('only compares within a position group by default', () => {
    const subject = { playerId: 'p1', positionGroup: 'MF', vector: { a: 80 } };
    const results = findSimilarPlayers(subject, [
      { playerId: 'p2', positionGroup: 'MF', vector: { a: 78 } },
      { playerId: 'p3', positionGroup: 'FW', vector: { a: 80 } },
    ]);

    expect(results.map((entry) => entry.playerId)).toEqual(['p2']);
  });
});

/** Team style (§31). */
describe('computeTeamStyle', () => {
  it('produces all fourteen dimensions', () => {
    const population = [1, 2, 3, 4, 5];
    const result = computeTeamStyle({
      possession: { value: 5, population },
      passesP90: { value: 5, population },
      passAccuracy: { value: 5, population },
      progressionP90: { value: 5, population },
      xgP90: { value: 5, population },
      xgAgainstP90: { value: 1, population },
      shotsP90: { value: 5, population },
      pressuresP90: { value: 5, population },
      recoveriesP90: { value: 5, population },
      finalThirdEntriesP90: { value: 5, population },
      boxEntriesP90: { value: 5, population },
      fieldTilt: { value: 5, population },
      ppda: { value: 1, population },
      directness: { value: 5, population },
      crossesP90: { value: 5, population },
    });

    expect(Object.keys(result.style)).toHaveLength(STYLE_DIMENSIONS.length);
    expect(result.coverage).toBe(1);
    // Low PPDA means a high press; low xG against means a compact defence.
    // The value ties the population minimum, so it ranks 20th and inverts to 80th.
    expect(result.style.highPress).toBeGreaterThan(50);
    expect(result.style.defensiveCompactness).toBe(80);
  });
});

/** Club fit (§32). */
describe('computeClubFit', () => {
  it('rewards a player who supplies what the team demands', () => {
    const dna = { Possession: 90, Passing: 90, Progression: 85, Pressing: 30 };
    const possessionTeam = { possession: 95, buildUp: 90, progression: 85, highPress: 40 };

    const result = computeClubFit(dna, possessionTeam);
    expect(result.fitScore).toBeGreaterThan(70);
    expect(result.components.length).toBeGreaterThan(0);
    expect(result.note).toBe(FIT_MODEL_NOTE);
  });

  it('scores a mismatch lower than a match', () => {
    const presser = { Pressing: 95, Defending: 80, Physical: 85, Possession: 20, Passing: 25 };
    const technician = { Pressing: 15, Defending: 20, Physical: 25, Possession: 95, Passing: 92 };
    const pressingTeam = { highPress: 95, counterpress: 92, defensiveAggression: 88 };

    expect(computeClubFit(presser, pressingTeam).fitScore).toBeGreaterThan(
      computeClubFit(technician, pressingTeam).fitScore,
    );
  });

  it('names the biggest gaps so the score can be argued with', () => {
    const result = computeClubFit(
      { Pressing: 10, Defending: 20, Possession: 90, Passing: 90 },
      { highPress: 95, possession: 90 },
    );

    expect(result.gaps[0]?.label).toBe('High press');
    expect(result.strengths.length).toBeGreaterThan(0);
  });

  it('returns 0 when the team demands nothing above average', () => {
    expect(computeClubFit({ Passing: 90 }, { possession: 50, buildUp: 40 }).fitScore).toBe(0);
  });
});

/** §92: an unavailable metric family must be absent, not zero. */
describe('computeDna with missing data', () => {
  it('omits a category nothing was measured for', () => {
    const result = computeDna(
      inputs({ passesP90: 40, passAccuracy: 0.85 }, [10, 20, 30, 40]),
      'MF',
    );

    // Physical needs tracking data, which is not present here.
    expect(result.scores.Physical).toBeUndefined();
    expect(result.scores.Passing).toBeGreaterThan(0);

    // The computation is still recorded for transparency.
    const physical = result.categories.find((entry) => entry.category === 'Physical');
    expect(physical).toBeDefined();
    expect(physical?.coverage).toBe(0);
  });
});
