import { describe, expect, it } from 'vitest';
import {
  aggregatePlayerStats,
  per90,
  percentileRank,
  positionGroup,
  scoutScore,
  type MatchStatLike,
} from '../src/domain/analytics.js';

const stat = (overrides: Partial<MatchStatLike> = {}): MatchStatLike => ({
  minutesPlayed: 90,
  goals: 0,
  assists: 0,
  shots: 0,
  xg: 0,
  xa: 0,
  passes: 0,
  passesCompleted: 0,
  progressivePasses: 0,
  duelsWon: 0,
  duelsTotal: 0,
  ...overrides,
});

describe('per90', () => {
  it('normalises totals to a full match', () => {
    expect(per90(2, 180)).toBe(1);
    expect(per90(1, 45)).toBe(2);
  });

  it('returns 0 without minutes instead of dividing by zero', () => {
    expect(per90(3, 0)).toBe(0);
  });
});

describe('aggregatePlayerStats', () => {
  it('sums totals and derives rates', () => {
    const aggregate = aggregatePlayerStats([
      stat({ goals: 1, passes: 50, passesCompleted: 40, duelsTotal: 10, duelsWon: 6 }),
      stat({ goals: 1, passes: 50, passesCompleted: 45, duelsTotal: 10, duelsWon: 4 }),
    ]);

    expect(aggregate.matches).toBe(2);
    expect(aggregate.minutesPlayed).toBe(180);
    expect(aggregate.goalsPer90).toBe(1);
    expect(aggregate.passAccuracy).toBe(0.85);
    expect(aggregate.duelWinRate).toBe(0.5);
  });

  it('handles a player with no data', () => {
    const aggregate = aggregatePlayerStats([]);
    expect(aggregate.matches).toBe(0);
    expect(aggregate.passAccuracy).toBe(0);
    expect(aggregate.goalsPer90).toBe(0);
  });
});

describe('percentileRank', () => {
  it('ranks within the population', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBe(100);
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBe(60);
    expect(percentileRank(0, [1, 2, 3, 4, 5])).toBe(0);
  });

  it('is defined for an empty population', () => {
    expect(percentileRank(1, [])).toBe(0);
  });
});

describe('positionGroup', () => {
  it('maps free-form provider positions onto groups', () => {
    expect(positionGroup('GK')).toBe('GK');
    expect(positionGroup('goalkeeper')).toBe('GK');
    expect(positionGroup('CB')).toBe('DF');
    expect(positionGroup('cdm')).toBe('MF');
    expect(positionGroup('ST')).toBe('FW');
    expect(positionGroup('something unknown')).toBe('MF');
  });
});

describe('scoutScore', () => {
  it('scores a dominant striker near the top of its population', () => {
    const elite = aggregatePlayerStats([stat({ goals: 2, xg: 1.5, xa: 0.5, duelsTotal: 10, duelsWon: 8 })]);
    const weak = aggregatePlayerStats([stat({ goals: 0, xg: 0.1, xa: 0, duelsTotal: 10, duelsWon: 2 })]);

    const score = scoutScore({ position: 'ST', aggregate: elite, population: [elite, weak, weak] });
    expect(score).toBeGreaterThan(90);
  });

  it('is comparable across positions because it uses percentiles', () => {
    const aggregate = aggregatePlayerStats([stat({ passes: 60, passesCompleted: 54 })]);
    const score = scoutScore({ position: 'CB', aggregate, population: [aggregate] });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
