import type { CoordinateSystem } from '@prisma/client';

/**
 * Coordinate standardisation (§33).
 *
 * Every provider passes through this layer. Internally ScoutIQ only ever deals
 * with a canonical 105 x 68 metre pitch, attacking left-to-right, origin at the
 * bottom-left corner. A metric computed on StatsBomb data and one computed on
 * Metrica data are therefore directly comparable.
 */

export const PITCH_LENGTH_M = 105;
export const PITCH_WIDTH_M = 68;

export interface Point {
  x: number;
  y: number;
}

export interface TransformOptions {
  /** Mirror the coordinates, e.g. for a team attacking right-to-left. */
  flip?: boolean;
  /** Provider pitch dimensions, when the system is PROVIDER_SPECIFIC. */
  sourceLength?: number;
  sourceWidth?: number;
  /** Some providers put the origin top-left; y then needs inverting. */
  invertY?: boolean;
}

interface SourceSpace {
  length: number;
  width: number;
  invertY: boolean;
}

const SPACES: Record<CoordinateSystem, SourceSpace | null> = {
  CANONICAL_105_68: { length: 105, width: 68, invertY: false },
  NORMALIZED_0_1: { length: 1, width: 1, invertY: false },
  RANGE_0_100: { length: 100, width: 100, invertY: false },
  // StatsBomb: 120 x 80, origin top-left, so y grows downwards.
  STATSBOMB_120_80: { length: 120, width: 80, invertY: true },
  OPTA_100_100: { length: 100, width: 100, invertY: false },
  // Metrica normalises to 0..1 with the origin at the top-left.
  METRICA_0_1: { length: 1, width: 1, invertY: true },
  PROVIDER_SPECIFIC: null,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const round = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Convert a provider point to canonical metres.
 *
 * Out-of-range values are clamped rather than dropped: providers do emit
 * slightly out-of-bounds coordinates, and silently losing an event would
 * distort counts more than a centimetre of clamping does.
 */
export function toCanonical(
  point: Point,
  system: CoordinateSystem,
  options: TransformOptions = {},
): Point {
  const space = SPACES[system] ?? {
    length: options.sourceLength ?? PITCH_LENGTH_M,
    width: options.sourceWidth ?? PITCH_WIDTH_M,
    invertY: false,
  };

  if (space.length <= 0 || space.width <= 0) {
    throw new Error(`Invalid source pitch dimensions for coordinate system ${system}`);
  }

  const invertY = options.invertY ?? space.invertY;

  let x = (point.x / space.length) * PITCH_LENGTH_M;
  let y = (point.y / space.width) * PITCH_WIDTH_M;

  if (invertY) y = PITCH_WIDTH_M - y;

  if (options.flip) {
    x = PITCH_LENGTH_M - x;
    y = PITCH_WIDTH_M - y;
  }

  return {
    x: round(clamp(x, 0, PITCH_LENGTH_M)),
    y: round(clamp(y, 0, PITCH_WIDTH_M)),
  };
}

/** Canonical point back into a provider space - used by exports and tests. */
export function fromCanonical(point: Point, system: CoordinateSystem): Point {
  const space = SPACES[system];
  if (!space) throw new Error(`Cannot invert PROVIDER_SPECIFIC coordinates without dimensions`);

  const x = (point.x / PITCH_LENGTH_M) * space.length;
  let y = (point.y / PITCH_WIDTH_M) * space.width;
  if (space.invertY) y = space.width - y;

  return { x: round(x, 4), y: round(y, 4) };
}

export const distance = (a: Point, b: Point): number =>
  round(Math.hypot(b.x - a.x, b.y - a.y));

/** Angle of a->b in radians, 0 = straight towards the opponent goal. */
export const angle = (a: Point, b: Point): number =>
  round(Math.atan2(b.y - a.y, b.x - a.x), 4);

export const isInFinalThird = (point: Point): boolean =>
  point.x >= (PITCH_LENGTH_M * 2) / 3;

/** 16.5m box, 40.32m wide, centred on the goal. */
export const isInBox = (point: Point): boolean =>
  point.x >= PITCH_LENGTH_M - 16.5 && point.y >= 13.84 && point.y <= PITCH_WIDTH_M - 13.84;

export const isInOwnBox = (point: Point): boolean =>
  point.x <= 16.5 && point.y >= 13.84 && point.y <= PITCH_WIDTH_M - 13.84;

/** Distance to the centre of the opponent goal. */
export const distanceToGoal = (point: Point): number =>
  distance(point, { x: PITCH_LENGTH_M, y: PITCH_WIDTH_M / 2 });

/** Visible goal angle in degrees - the standard xG geometry input. */
export function goalAngleDeg(point: Point): number {
  const postA = { x: PITCH_LENGTH_M, y: PITCH_WIDTH_M / 2 - 3.66 };
  const postB = { x: PITCH_LENGTH_M, y: PITCH_WIDTH_M / 2 + 3.66 };
  const a = distance(point, postA);
  const b = distance(point, postB);
  const goalWidth = 7.32;
  if (a === 0 || b === 0) return 0;
  const cosine = (a * a + b * b - goalWidth * goalWidth) / (2 * a * b);
  return round((Math.acos(clamp(cosine, -1, 1)) * 180) / Math.PI, 2);
}

/**
 * A progressive action per the common definition: moves the ball at least 25%
 * closer to the opponent goal, and ends in the opponent half or advances at
 * least 10 metres.
 */
export function isProgressive(from: Point, to: Point): boolean {
  const before = distanceToGoal(from);
  const after = distanceToGoal(to);
  if (after >= before) return false;
  const gain = before - after;
  return gain >= before * 0.25 || (to.x > PITCH_LENGTH_M / 2 && gain >= 10);
}

export const progressiveDistance = (from: Point, to: Point): number =>
  round(Math.max(0, distanceToGoal(from) - distanceToGoal(to)));
