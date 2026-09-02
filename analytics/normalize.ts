/**
 * Normalisation (§26).
 *
 * Four modes, all with an EXPLICIT population: raw, per-90, percentile and
 * z-score. A percentile without a stated population is meaningless, so every
 * function here returns the population it used.
 */

export type NormalizationMode = 'RAW' | 'PER_90' | 'PER_POSSESSION' | 'PERCENTILE' | 'Z_SCORE';

export interface PopulationDefinition {
  /** e.g. "competition_season+position_group" */
  definition: string;
  competitionSeasonId?: string | undefined;
  positionGroup?: string | undefined;
  minMinutes: number;
  size: number;
}

const round = (value: number, decimals = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Per-90 normalisation. Returns 0 for players without minutes. */
export function per90(total: number, minutesPlayed: number): number {
  if (minutesPlayed <= 0) return 0;
  return round((total / minutesPlayed) * 90);
}

/**
 * Per-possession normalisation: actions per 100 team possessions. Used to
 * compare players in teams that see very different volumes of the ball.
 */
export function perPossession(total: number, teamPossessions: number): number {
  if (teamPossessions <= 0) return 0;
  return round((total / teamPossessions) * 100);
}

/**
 * Percentile rank of `value` within `population`, 0-100.
 * Uses the "proportion at or below" definition, so the best value scores 100.
 */
export function percentileRank(value: number, population: readonly number[]): number {
  if (population.length === 0) return 0;
  const atOrBelow = population.filter((candidate) => candidate <= value).length;
  return round((atOrBelow / population.length) * 100, 1);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return round(Math.sqrt(variance));
}

export function zScore(value: number, population: readonly number[]): number {
  const deviation = stddev(population);
  if (deviation === 0) return 0;
  return round((value - mean(population)) / deviation);
}

export interface NormalizedValue {
  raw: number;
  per90?: number;
  percentile: number;
  zScore: number;
  population: PopulationDefinition;
}

export function normalize(
  value: number,
  population: readonly number[],
  definition: PopulationDefinition,
): NormalizedValue {
  return {
    raw: value,
    percentile: percentileRank(value, population),
    zScore: zScore(value, population),
    population: { ...definition, size: population.length },
  };
}

/** Invert a percentile for metrics where lower is better (e.g. fouls). */
export const invertPercentile = (percentile: number): number =>
  round(100 - percentile, 1);
