import type { DnaCategory } from '@/analytics/dna';
import type { StyleDimension } from '@/analytics/team-style';

/**
 * Player-to-club fit (§32).
 *
 * The model asks: does this player's profile supply what this team's style
 * demands? Each team dimension is mapped onto the player DNA categories that
 * serve it; the fit is the demand-weighted match between the two.
 *
 * This is an ANALYTICAL MODEL, not objective truth, and every surface that
 * shows a fit score says so (§32). The breakdown is always returned (§85).
 */

interface DemandMapping {
  dimension: StyleDimension;
  /** DNA categories that satisfy this dimension, with relative weights. */
  categories: Partial<Record<DnaCategory, number>>;
  label: string;
}

const DEMAND_MODEL: DemandMapping[] = [
  {
    dimension: 'possession',
    label: 'Possession',
    categories: { Possession: 0.6, Passing: 0.4 },
  },
  {
    dimension: 'buildUp',
    label: 'Build-up',
    categories: { Passing: 0.6, Possession: 0.4 },
  },
  {
    dimension: 'progression',
    label: 'Progression',
    categories: { Progression: 0.7, 'Ball Carrying': 0.3 },
  },
  {
    dimension: 'directness',
    label: 'Directness',
    categories: { Positioning: 0.4, Physical: 0.3, Duels: 0.3 },
  },
  {
    dimension: 'chanceCreation',
    label: 'Chance creation',
    categories: { 'Chance Creation': 0.7, Finishing: 0.3 },
  },
  {
    dimension: 'crossing',
    label: 'Crossing',
    categories: { 'Chance Creation': 0.5, 'Ball Carrying': 0.5 },
  },
  {
    dimension: 'width',
    label: 'Width',
    categories: { 'Ball Carrying': 0.6, Physical: 0.4 },
  },
  {
    dimension: 'centralAttack',
    label: 'Central attack',
    categories: { Positioning: 0.5, Finishing: 0.5 },
  },
  {
    dimension: 'highPress',
    label: 'High press',
    categories: { Pressing: 0.7, Physical: 0.3 },
  },
  {
    dimension: 'counterpress',
    label: 'Counterpress',
    categories: { Pressing: 0.6, Defending: 0.4 },
  },
  {
    dimension: 'defensiveAggression',
    label: 'Defensive aggression',
    categories: { Defending: 0.5, Duels: 0.5 },
  },
  {
    dimension: 'defensiveCompactness',
    label: 'Defensive compactness',
    categories: { Defending: 0.6, Positioning: 0.4 },
  },
  {
    dimension: 'transition',
    label: 'Transition',
    categories: { 'Ball Carrying': 0.4, Progression: 0.3, Physical: 0.3 },
  },
  {
    dimension: 'lowBlock',
    label: 'Low block',
    categories: { Defending: 0.6, Duels: 0.4 },
  },
];

export interface FitComponent {
  dimension: StyleDimension;
  label: string;
  /** How much this team asks for this quality, 0-100. */
  demand: number;
  /** How much the player supplies it, 0-100. */
  supply: number;
  /** Points earned out of `maxPoints`. */
  points: number;
  maxPoints: number;
}

export interface FitResult {
  fitScore: number;
  components: FitComponent[];
  /** Dimensions the team demands most that the player supplies least. */
  gaps: FitComponent[];
  strengths: FitComponent[];
  note: string;
}

const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const FIT_MODEL_NOTE =
  'Analytical model output based on style percentiles, not objective truth. ' +
  'It describes stylistic overlap, not quality, availability or cost.';

/**
 * Compute the fit between a player's DNA and a team's style.
 *
 * Only dimensions the team actually demands (score above the neutral 50) pull
 * weight: fitting a team's *absence* of a trait is not a fit.
 */
export function computeClubFit(
  dna: Record<string, number>,
  teamStyle: Record<string, number>,
): FitResult {
  const components: FitComponent[] = [];
  let earned = 0;
  let available = 0;

  for (const mapping of DEMAND_MODEL) {
    const demand = teamStyle[mapping.dimension];
    if (demand === undefined) continue;

    // Demand above the neutral midpoint is what the team actually asks for.
    const weight = Math.max(0, demand - 50) / 50;
    if (weight === 0) continue;

    let supply = 0;
    let supplyWeight = 0;
    for (const [category, categoryWeight] of Object.entries(mapping.categories)) {
      const score = dna[category];
      if (score === undefined) continue;
      supply += score * (categoryWeight as number);
      supplyWeight += categoryWeight as number;
    }
    if (supplyWeight === 0) continue;

    const normalisedSupply = supply / supplyWeight;
    const maxPoints = round(weight * 25);
    const points = round((normalisedSupply / 100) * maxPoints);

    earned += points;
    available += maxPoints;

    components.push({
      dimension: mapping.dimension,
      label: mapping.label,
      demand: round(demand),
      supply: round(normalisedSupply),
      points,
      maxPoints,
    });
  }

  const fitScore = available > 0 ? round((earned / available) * 100) : 0;
  const ranked = [...components].sort(
    (a, b) => b.maxPoints - b.points - (a.maxPoints - a.points),
  );

  return {
    fitScore,
    components: components.sort((a, b) => b.maxPoints - a.maxPoints),
    gaps: ranked.slice(0, 3),
    strengths: [...components].sort((a, b) => b.points - a.points).slice(0, 3),
    note: FIT_MODEL_NOTE,
  };
}
