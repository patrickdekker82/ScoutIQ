import { describe, expect, it } from 'vitest';
import {
  invertPercentile,
  mean,
  per90,
  percentileRank,
  perPossession,
  stddev,
  zScore,
} from '@/analytics/normalize';

/** Normalisation modes (§26). */
describe('per90', () => {
  it('normalises totals to a full match', () => {
    expect(per90(2, 180)).toBe(1);
    expect(per90(1, 45)).toBe(2);
  });

  it('returns 0 without minutes rather than dividing by zero', () => {
    expect(per90(3, 0)).toBe(0);
  });
});

describe('perPossession', () => {
  it('expresses actions per 100 team possessions', () => {
    expect(perPossession(12, 240)).toBe(5);
    expect(perPossession(5, 0)).toBe(0);
  });
});

describe('percentileRank', () => {
  it('ranks within an explicit population', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBe(100);
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBe(60);
    expect(percentileRank(0, [1, 2, 3, 4, 5])).toBe(0);
  });

  it('is defined for an empty population', () => {
    expect(percentileRank(1, [])).toBe(0);
  });

  it('inverts for metrics where lower is better', () => {
    expect(invertPercentile(percentileRank(5, [1, 2, 3, 4, 5]))).toBe(0);
  });
});

describe('z-score', () => {
  it('measures distance from the population mean in standard deviations', () => {
    const population = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(population)).toBe(5);
    expect(stddev(population)).toBe(2);
    expect(zScore(9, population)).toBe(2);
    expect(zScore(5, population)).toBe(0);
  });

  it('returns 0 when every value is identical', () => {
    expect(zScore(3, [3, 3, 3])).toBe(0);
  });
});
