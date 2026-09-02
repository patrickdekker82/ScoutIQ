import { percentileRank } from '@/analytics/normalize';

/**
 * Team style engine (§31).
 *
 * Fourteen dimensions, each 0-100, derived from team season metrics ranked
 * within the competition. Like Player DNA these are percentile-based, so a
 * "high press" score means high relative to this league, not relative to an
 * absolute scale that would differ per provider.
 */

export const STYLE_DIMENSIONS = [
  'possession',
  'buildUp',
  'directness',
  'progression',
  'width',
  'centralAttack',
  'crossing',
  'chanceCreation',
  'highPress',
  'counterpress',
  'lowBlock',
  'transition',
  'defensiveAggression',
  'defensiveCompactness',
] as const;

export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export interface StyleInput {
  value: number | null;
  population: number[];
  /** Lower values score higher on this dimension (e.g. PPDA for pressing). */
  invert?: boolean;
}

/** Which team metrics feed which dimension, and with what weight. */
export const STYLE_DEFINITION: Record<StyleDimension, Record<string, number>> = {
  possession: { possession: 0.6, passesP90: 0.4 },
  buildUp: { passAccuracy: 0.5, passesP90: 0.3, progressionP90: 0.2 },
  directness: { directness: 1 },
  progression: { progressionP90: 0.6, finalThirdEntriesP90: 0.4 },
  width: { crossesP90: 0.6, fieldTilt: 0.4 },
  centralAttack: { boxEntriesP90: 0.6, xgP90: 0.4 },
  crossing: { crossesP90: 1 },
  chanceCreation: { xgP90: 0.5, shotsP90: 0.3, boxEntriesP90: 0.2 },
  highPress: { ppda: 0.6, pressuresP90: 0.4 },
  counterpress: { pressuresP90: 0.5, recoveriesP90: 0.5 },
  lowBlock: { ppda: 0.5, possession: 0.5 },
  transition: { directness: 0.5, progressionP90: 0.5 },
  defensiveAggression: { pressuresP90: 0.5, recoveriesP90: 0.5 },
  defensiveCompactness: { xgAgainstP90: 1 },
};

/** Dimensions where a LOW metric value means a HIGH dimension score. */
const INVERTED: Partial<Record<StyleDimension, Set<string>>> = {
  highPress: new Set(['ppda']),
  lowBlock: new Set(['possession']),
  defensiveCompactness: new Set(['xgAgainstP90']),
};

export interface StyleContribution {
  metricKey: string;
  value: number;
  percentile: number;
  weight: number;
}

export interface TeamStyleResult {
  style: Record<string, number>;
  inputs: Record<string, StyleContribution[]>;
  coverage: number;
}

const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export function computeTeamStyle(metrics: Record<string, StyleInput>): TeamStyleResult {
  const style: Record<string, number> = {};
  const inputs: Record<string, StyleContribution[]> = {};
  let covered = 0;

  for (const dimension of STYLE_DIMENSIONS) {
    const weights = STYLE_DEFINITION[dimension];
    const contributions: StyleContribution[] = [];
    let weighted = 0;
    let usedWeight = 0;

    for (const [metricKey, weight] of Object.entries(weights)) {
      const input = metrics[metricKey];
      if (!input || input.value === null || input.population.length === 0) continue;

      const raw = percentileRank(input.value, input.population);
      const inverted = input.invert ?? INVERTED[dimension]?.has(metricKey) ?? false;
      const percentile = inverted ? round(100 - raw) : raw;

      weighted += percentile * weight;
      usedWeight += weight;
      contributions.push({ metricKey, value: input.value, percentile, weight });
    }

    style[dimension] = usedWeight > 0 ? round(weighted / usedWeight) : 0;
    inputs[dimension] = contributions;
    if (usedWeight > 0) covered += 1;
  }

  return {
    style,
    inputs,
    coverage: round(covered / STYLE_DIMENSIONS.length, 2),
  };
}
