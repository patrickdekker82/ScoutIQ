import { describe, expect, it } from 'vitest';
import {
  distanceToGoal,
  fromCanonical,
  goalAngleDeg,
  isInBox,
  isInFinalThird,
  isProgressive,
  PITCH_LENGTH_M,
  PITCH_WIDTH_M,
  progressiveDistance,
  toCanonical,
} from '@/analytics/coordinates';

/** Coordinate transformation (§33). */
describe('toCanonical', () => {
  it('maps StatsBomb 120x80 with a top-left origin onto 105x68', () => {
    // StatsBomb centre spot.
    expect(toCanonical({ x: 60, y: 40 }, 'STATSBOMB_120_80')).toEqual({ x: 52.5, y: 34 });
    // Their y grows downwards, so y=0 is the far touchline in canonical space.
    expect(toCanonical({ x: 0, y: 0 }, 'STATSBOMB_120_80')).toEqual({ x: 0, y: 68 });
    expect(toCanonical({ x: 120, y: 80 }, 'STATSBOMB_120_80')).toEqual({ x: 105, y: 0 });
  });

  it('maps Metrica normalised coordinates', () => {
    expect(toCanonical({ x: 0.5, y: 0.5 }, 'METRICA_0_1')).toEqual({ x: 52.5, y: 34 });
  });

  it('maps 0-100 provider grids', () => {
    expect(toCanonical({ x: 50, y: 50 }, 'OPTA_100_100')).toEqual({ x: 52.5, y: 34 });
  });

  it('passes canonical coordinates through unchanged', () => {
    expect(toCanonical({ x: 88.2, y: 12.5 }, 'CANONICAL_105_68')).toEqual({ x: 88.2, y: 12.5 });
  });

  it('flips for a team attacking the other way', () => {
    expect(toCanonical({ x: 105, y: 0 }, 'CANONICAL_105_68', { flip: true })).toEqual({
      x: 0,
      y: 68,
    });
  });

  it('clamps out-of-range provider values instead of dropping the event', () => {
    const point = toCanonical({ x: 125, y: -3 }, 'STATSBOMB_120_80');
    expect(point.x).toBe(PITCH_LENGTH_M);
    expect(point.y).toBeLessThanOrEqual(PITCH_WIDTH_M);
    expect(point.y).toBeGreaterThanOrEqual(0);
  });

  it('round-trips back into provider space', () => {
    const canonical = toCanonical({ x: 90, y: 20 }, 'STATSBOMB_120_80');
    const back = fromCanonical(canonical, 'STATSBOMB_120_80');
    expect(back.x).toBeCloseTo(90, 3);
    expect(back.y).toBeCloseTo(20, 3);
  });
});

describe('pitch geometry', () => {
  it('identifies the final third and the box', () => {
    expect(isInFinalThird({ x: 70, y: 34 })).toBe(true);
    expect(isInFinalThird({ x: 69, y: 34 })).toBe(false);
    expect(isInBox({ x: 95, y: 34 })).toBe(true);
    expect(isInBox({ x: 95, y: 5 })).toBe(false);
  });

  it('measures distance and angle to goal', () => {
    expect(distanceToGoal({ x: 105, y: 34 })).toBe(0);
    expect(distanceToGoal({ x: 93, y: 34 })).toBe(12);
    // A shot from the penalty spot sees far more goal than one from the corner.
    expect(goalAngleDeg({ x: 94, y: 34 })).toBeGreaterThan(goalAngleDeg({ x: 94, y: 2 }));
  });
});

describe('progressive actions', () => {
  it('recognises a pass that meaningfully advances the ball', () => {
    expect(isProgressive({ x: 20, y: 34 }, { x: 60, y: 34 })).toBe(true);
  });

  it('rejects a sideways or backwards pass', () => {
    expect(isProgressive({ x: 60, y: 20 }, { x: 60, y: 48 })).toBe(false);
    expect(isProgressive({ x: 60, y: 34 }, { x: 40, y: 34 })).toBe(false);
  });

  it('rejects a small gain deep in the opponent half', () => {
    expect(isProgressive({ x: 95, y: 34 }, { x: 96, y: 34 })).toBe(false);
  });

  it('measures how much closer to goal the ball ended', () => {
    expect(progressiveDistance({ x: 20, y: 34 }, { x: 60, y: 34 })).toBe(40);
    expect(progressiveDistance({ x: 60, y: 34 }, { x: 20, y: 34 })).toBe(0);
  });
});
