import { EventType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  aggregateSeason,
  computePlayerMatchMetrics,
  emptyMetrics,
  estimateXg,
  seasonPer90,
  type MetricEventInput,
} from '@/analytics/metrics';

const event = (overrides: Partial<MetricEventInput> & { type: EventType }): MetricEventInput => ({
  playerId: 'p1',
  teamId: 't1',
  x: 50,
  y: 34,
  endX: null,
  endY: null,
  outcome: null,
  underPressure: false,
  durationSec: null,
  ...overrides,
});

/** Metric engine (§25, §83). */
describe('computePlayerMatchMetrics', () => {
  it('counts passes and derives accuracy', () => {
    const metrics = computePlayerMatchMetrics(
      [
        event({ type: EventType.PASS, endX: 70, endY: 34, pass: passDetail({ completed: true }) }),
        event({ type: EventType.PASS, endX: 70, endY: 34, pass: passDetail({ completed: true }) }),
        event({ type: EventType.PASS, endX: 70, endY: 34, pass: passDetail({ completed: false }) }),
      ],
      90,
    );

    expect(metrics.passes).toBe(3);
    expect(metrics.passesCompleted).toBe(2);
    expect(metrics.passAccuracy).toBeCloseTo(0.667, 2);
    expect(metrics.available.passing).toBe(true);
  });

  it('derives progression from coordinates when the provider omits the flag', () => {
    const metrics = computePlayerMatchMetrics(
      [event({ type: EventType.PASS, x: 20, y: 34, endX: 70, endY: 34, pass: null })],
      90,
    );
    expect(metrics.progressivePasses).toBe(1);
    expect(metrics.progressiveActions).toBe(1);
  });

  it('accumulates xG and separates non-penalty xG', () => {
    const metrics = computePlayerMatchMetrics(
      [
        event({
          type: EventType.SHOT,
          x: 95,
          y: 34,
          shot: { xg: 0.4, onTarget: true, isGoal: true, isPenalty: false, blocked: false },
        }),
        event({
          type: EventType.SHOT,
          x: 94,
          y: 34,
          shot: { xg: 0.76, onTarget: true, isGoal: true, isPenalty: true, blocked: false },
        }),
      ],
      90,
    );

    expect(metrics.shots).toBe(2);
    expect(metrics.goals).toBe(2);
    expect(metrics.xg).toBeCloseTo(1.16, 2);
    expect(metrics.npxg).toBeCloseTo(0.4, 2);
  });

  it('separates aerial from ground duels', () => {
    const metrics = computePlayerMatchMetrics(
      [
        event({ type: EventType.DUEL, duel: { duelType: 'AERIAL', won: true } }),
        event({ type: EventType.DUEL, duel: { duelType: 'GROUND', won: false } }),
      ],
      90,
    );

    expect(metrics.aerialDuels).toBe(1);
    expect(metrics.aerialDuelsWon).toBe(1);
    expect(metrics.defensiveDuels).toBe(1);
    expect(metrics.defensiveDuelsWon).toBe(0);
  });

  it('records which metric families the source data supported (§54, §92)', () => {
    const metrics = computePlayerMatchMetrics(
      [event({ type: EventType.PASS, pass: passDetail({ completed: true }) })],
      90,
    );

    expect(metrics.available.passing).toBe(true);
    // No shots in the source, so shooting stays unavailable rather than "zero".
    expect(metrics.available.shooting).toBe(false);
    expect(metrics.available.pressing).toBe(false);
  });
});

describe('aggregateSeason and seasonPer90', () => {
  it('sums matches and converts to per-90 rates', () => {
    const match = computePlayerMatchMetrics(
      [
        event({ type: EventType.PASS, endX: 70, endY: 34, pass: passDetail({ completed: true }) }),
        event({
          type: EventType.SHOT,
          x: 95,
          y: 34,
          shot: { xg: 0.2, onTarget: true, isGoal: false, isPenalty: false, blocked: false },
        }),
      ],
      90,
    );

    const season = aggregateSeason([
      { metrics: match, isStarter: true },
      { metrics: match, isStarter: false },
    ]);

    expect(season.matches).toBe(2);
    expect(season.starts).toBe(1);
    expect(season.minutes).toBe(180);
    expect(season.shots).toBe(2);

    const rates = seasonPer90(season);
    expect(rates.shotsP90).toBe(1);
    expect(rates.xgP90).toBeCloseTo(0.2, 3);
  });

  it('handles a player with no data', () => {
    const season = aggregateSeason([]);
    expect(season.matches).toBe(0);
    expect(seasonPer90(season).passesP90).toBe(0);
    expect(emptyMetrics().passAccuracy).toBe(0);
  });
});

describe('estimateXg', () => {
  it('falls back to geometry when a provider ships no xG', () => {
    const close = estimateXg({ x: 100, y: 34 });
    const far = estimateXg({ x: 70, y: 34 });
    expect(close).toBeGreaterThan(far);
    expect(estimateXg({ x: 94, y: 34 }, false, true)).toBe(0.76);
    // Headers are harder than the same chance struck with the foot.
    expect(estimateXg({ x: 100, y: 34 }, true)).toBeLessThan(close);
  });
});

function passDetail(overrides: { completed: boolean }) {
  return {
    completed: overrides.completed,
    isCross: false,
    isSwitch: false,
    isThroughBall: false,
    isProgressive: false,
    intoFinalThird: false,
    intoBox: false,
    isKeyPass: false,
    isAssist: false,
    lengthM: 15,
    xa: null,
  };
}
