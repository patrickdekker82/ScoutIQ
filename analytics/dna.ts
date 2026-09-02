import { percentileRank } from '@/analytics/normalize';
import type { PositionGroup } from '@/analytics/positions';

/**
 * Player DNA (§27).
 *
 * Eleven categories, each 0-100. A category score is the weighted average of
 * the percentile ranks of its input metrics within an explicit population.
 * Nothing here is a black box: `inputs` records every metric, its value, its
 * percentile and its weight, and that record is stored alongside the score
 * (§85) and shown in the UI.
 */

export const DNA_CATEGORIES = [
  'Passing',
  'Progression',
  'Ball Carrying',
  'Chance Creation',
  'Finishing',
  'Possession',
  'Defending',
  'Pressing',
  'Duels',
  'Positioning',
  'Physical',
] as const;

export type DnaCategory = (typeof DNA_CATEGORIES)[number];

/** Metric keys are the per-90 column names of player_season_metrics. */
export const DNA_DEFINITION: Record<DnaCategory, Record<string, number>> = {
  Passing: {
    passesP90: 0.2,
    passAccuracy: 0.35,
    longPassesP90: 0.15,
    passesFinalThirdP90: 0.3,
  },
  Progression: {
    progressivePassesP90: 0.4,
    progressiveCarriesP90: 0.3,
    progressiveActionsP90: 0.2,
    passesFinalThirdP90: 0.1,
  },
  'Ball Carrying': {
    progressiveCarriesP90: 0.4,
    dribblesP90: 0.25,
    dribbleSuccessRate: 0.25,
    carriesFinalThirdP90: 0.1,
  },
  'Chance Creation': {
    xaP90: 0.35,
    keyPassesP90: 0.3,
    chancesCreatedP90: 0.2,
    passesIntoBoxP90: 0.15,
  },
  Finishing: {
    xgP90: 0.3,
    goalsP90: 0.3,
    shotsP90: 0.2,
    xgPerShot: 0.2,
  },
  Possession: {
    touchesP90: 0.35,
    passAccuracy: 0.35,
    passesP90: 0.3,
  },
  Defending: {
    tacklesP90: 0.25,
    interceptionsP90: 0.25,
    blocksP90: 0.15,
    clearancesP90: 0.15,
    recoveriesP90: 0.2,
  },
  Pressing: {
    pressuresP90: 0.5,
    counterpressuresP90: 0.3,
    recoveriesP90: 0.2,
  },
  Duels: {
    defensiveDuelsP90: 0.2,
    defensiveDuelWinRate: 0.3,
    aerialDuelsP90: 0.2,
    aerialDuelWinRate: 0.3,
  },
  Positioning: {
    touchesFinalThirdP90: 0.4,
    touchesBoxP90: 0.4,
    carriesIntoBoxP90: 0.2,
  },
  Physical: {
    distanceP90: 0.3,
    highSpeedDistanceP90: 0.3,
    sprintCountP90: 0.2,
    maxSpeedMs: 0.2,
  },
};

/** Which categories are meaningful for which position group. */
export const CATEGORY_RELEVANCE: Record<PositionGroup, DnaCategory[]> = {
  GK: ['Passing', 'Possession', 'Positioning'],
  DF: ['Passing', 'Progression', 'Defending', 'Duels', 'Pressing', 'Possession', 'Physical'],
  MF: [
    'Passing',
    'Progression',
    'Ball Carrying',
    'Chance Creation',
    'Possession',
    'Defending',
    'Pressing',
    'Duels',
    'Physical',
  ],
  FW: [
    'Finishing',
    'Chance Creation',
    'Ball Carrying',
    'Positioning',
    'Progression',
    'Pressing',
    'Duels',
    'Physical',
  ],
};

export interface MetricInput {
  /** Metric value for the subject player. Null when the source data is absent. */
  value: number | null;
  /** Values of every comparable player, i.e. the reference population. */
  population: number[];
}

export type MetricInputs = Record<string, MetricInput>;

export interface DnaContribution {
  metricKey: string;
  value: number;
  percentile: number;
  weight: number;
  contribution: number;
}

export interface DnaCategoryResult {
  category: DnaCategory;
  score: number;
  /** Fraction of the category's weight that had usable data (0-1). */
  coverage: number;
  inputs: DnaContribution[];
}

export interface DnaResult {
  scores: Record<string, number>;
  categories: DnaCategoryResult[];
  /** Percentile vector used by similarity and club fit. */
  styleVector: Record<string, number>;
  coverage: number;
}

const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Compute the DNA. Metrics whose data is missing are dropped and the remaining
 * weights are renormalised, with `coverage` reporting how much of the category
 * was actually measurable - so a low-data player is visibly low-data rather
 * than quietly scored as average (§54).
 */
export function computeDna(inputs: MetricInputs, positionGroup: PositionGroup): DnaResult {
  const relevant = new Set<DnaCategory>(CATEGORY_RELEVANCE[positionGroup]);
  const categories: DnaCategoryResult[] = [];
  const styleVector: Record<string, number> = {};
  const scores: Record<string, number> = {};

  for (const [metricKey, input] of Object.entries(inputs)) {
    if (input.value === null) continue;
    styleVector[metricKey] = percentileRank(input.value, input.population);
  }

  for (const category of DNA_CATEGORIES) {
    const weights = DNA_DEFINITION[category];
    const contributions: DnaContribution[] = [];
    let weightedTotal = 0;
    let usedWeight = 0;
    let definedWeight = 0;

    for (const [metricKey, weight] of Object.entries(weights)) {
      definedWeight += weight;
      const input = inputs[metricKey];
      if (!input || input.value === null || input.population.length === 0) continue;

      const percentile = styleVector[metricKey] ?? percentileRank(input.value, input.population);
      weightedTotal += percentile * weight;
      usedWeight += weight;
      contributions.push({
        metricKey,
        value: input.value,
        percentile,
        weight,
        contribution: round(percentile * weight, 2),
      });
    }

    const score = usedWeight > 0 ? round(weightedTotal / usedWeight) : 0;
    const coverage = definedWeight > 0 ? round(usedWeight / definedWeight, 2) : 0;

    categories.push({ category, score, coverage, inputs: contributions });

    // `scores` drives the radar and club fit. A category is included only when
    // it is relevant to the position group AND something was actually measured:
    // a category with no source data must be ABSENT, not zero, or a player with
    // no tracking data would read as physically hopeless rather than unmeasured
    // (§92, "do not fabricate unavailable metrics").
    if (relevant.has(category) && usedWeight > 0) scores[category] = score;
  }

  const relevantResults = categories.filter((entry) => relevant.has(entry.category));
  const coverage =
    relevantResults.length > 0
      ? round(
          relevantResults.reduce((sum, entry) => sum + entry.coverage, 0) / relevantResults.length,
          2,
        )
      : 0;

  return { scores, categories, styleVector, coverage };
}
