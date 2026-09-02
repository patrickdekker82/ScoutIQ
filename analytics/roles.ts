import { percentileRank } from '@/analytics/normalize';
import type { PositionGroup } from '@/analytics/positions';

/**
 * Player role engine (§28) with role definitions as DATA (§84).
 *
 * The definitions below are the SEED of the player_roles table, not the source
 * of truth at runtime: the engine scores against whatever rows the database
 * holds, so a new scouting model is an INSERT, never a redeploy.
 */

export interface RoleRequirement {
  metricKey: string;
  weight: number;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
  minPercentile?: number;
  description?: string;
}

export interface RoleDefinition {
  key: string;
  name: string;
  positionGroup: PositionGroup;
  description: string;
  minMinutes: number;
  requirements: RoleRequirement[];
}

const higher = (
  metricKey: string,
  weight: number,
  description?: string,
): RoleRequirement => ({ metricKey, weight, direction: 'HIGHER_BETTER', ...(description ? { description } : {}) });

/** The 19 system roles of §28. */
export const SYSTEM_ROLES: RoleDefinition[] = [
  {
    key: 'ball-winning-6',
    name: 'Ball-Winning 6',
    positionGroup: 'MF',
    description: 'Screens the defence, wins the ball back, keeps possession simple.',
    minMinutes: 450,
    requirements: [
      higher('tacklesP90', 0.2),
      higher('interceptionsP90', 0.2),
      higher('recoveriesP90', 0.15),
      higher('defensiveDuelWinRate', 0.2),
      higher('pressuresP90', 0.15),
      higher('passAccuracy', 0.1),
    ],
  },
  {
    key: 'deep-lying-playmaker',
    name: 'Deep-Lying Playmaker',
    positionGroup: 'MF',
    description: 'Dictates tempo from deep with volume and range of passing.',
    minMinutes: 450,
    requirements: [
      higher('passesP90', 0.25),
      higher('passAccuracy', 0.2),
      higher('progressivePassesP90', 0.25),
      higher('longPassesP90', 0.15),
      higher('touchesP90', 0.15),
    ],
  },
  {
    key: 'progressive-6',
    name: 'Progressive 6',
    positionGroup: 'MF',
    description: 'Single pivot who breaks lines with pass and carry.',
    minMinutes: 450,
    requirements: [
      higher('progressivePassesP90', 0.3),
      higher('progressiveCarriesP90', 0.2),
      higher('passesFinalThirdP90', 0.2),
      higher('passAccuracy', 0.15),
      higher('interceptionsP90', 0.15),
    ],
  },
  {
    key: 'progressive-8',
    name: 'Progressive 8',
    positionGroup: 'MF',
    description: 'Advances the ball from midfield into the final third.',
    minMinutes: 450,
    requirements: [
      higher('progressiveActionsP90', 0.3),
      higher('progressiveCarriesP90', 0.25),
      higher('passesFinalThirdP90', 0.2),
      higher('touchesFinalThirdP90', 0.15),
      higher('dribblesP90', 0.1),
    ],
  },
  {
    key: 'box-to-box-8',
    name: 'Box-to-Box 8',
    positionGroup: 'MF',
    description: 'Covers ground in both boxes; volume in and out of possession.',
    minMinutes: 450,
    requirements: [
      higher('progressiveActionsP90', 0.2),
      higher('touchesBoxP90', 0.15),
      higher('tacklesP90', 0.15),
      higher('recoveriesP90', 0.15),
      higher('distanceP90', 0.2),
      higher('shotsP90', 0.15),
    ],
  },
  {
    key: 'advanced-playmaker',
    name: 'Advanced Playmaker',
    positionGroup: 'MF',
    description: 'Creates from between the lines with volume and quality.',
    minMinutes: 450,
    requirements: [
      higher('xaP90', 0.3),
      higher('keyPassesP90', 0.25),
      higher('passesIntoBoxP90', 0.2),
      higher('touchesFinalThirdP90', 0.15),
      higher('passAccuracy', 0.1),
    ],
  },
  {
    key: 'creative-10',
    name: 'Creative 10',
    positionGroup: 'MF',
    description: 'Primary creator: chances, through balls, final action.',
    minMinutes: 450,
    requirements: [
      higher('chancesCreatedP90', 0.3),
      higher('xaP90', 0.3),
      higher('passesIntoBoxP90', 0.2),
      higher('dribblesP90', 0.1),
      higher('touchesBoxP90', 0.1),
    ],
  },
  {
    key: 'inverted-winger',
    name: 'Inverted Winger',
    positionGroup: 'FW',
    description: 'Comes inside to shoot and combine rather than to cross.',
    minMinutes: 450,
    requirements: [
      higher('shotsP90', 0.25),
      higher('dribblesP90', 0.2),
      higher('touchesBoxP90', 0.2),
      higher('xgP90', 0.2),
      higher('carriesIntoBoxP90', 0.15),
    ],
  },
  {
    key: 'touchline-winger',
    name: 'Touchline Winger',
    positionGroup: 'FW',
    description: 'Holds the width, takes defenders on, delivers from wide.',
    minMinutes: 450,
    requirements: [
      higher('crossesP90', 0.3),
      higher('dribblesP90', 0.25),
      higher('dribbleSuccessRate', 0.2),
      higher('passesIntoBoxP90', 0.15),
      higher('progressiveCarriesP90', 0.1),
    ],
  },
  {
    key: 'inside-forward',
    name: 'Inside Forward',
    positionGroup: 'FW',
    description: 'Wide starting position, finishes as a second striker.',
    minMinutes: 450,
    requirements: [
      higher('xgP90', 0.3),
      higher('goalsP90', 0.25),
      higher('touchesBoxP90', 0.2),
      higher('dribblesP90', 0.15),
      higher('xaP90', 0.1),
    ],
  },
  {
    key: 'pressing-forward',
    name: 'Pressing Forward',
    positionGroup: 'FW',
    description: 'Leads the press, forces turnovers high up the pitch.',
    minMinutes: 450,
    requirements: [
      higher('pressuresP90', 0.35),
      higher('counterpressuresP90', 0.25),
      higher('recoveriesP90', 0.2),
      higher('distanceP90', 0.1),
      higher('tacklesP90', 0.1),
    ],
  },
  {
    key: 'target-striker',
    name: 'Target Striker',
    positionGroup: 'FW',
    description: 'Focal point: holds the ball up and wins the aerial battle.',
    minMinutes: 450,
    requirements: [
      higher('aerialDuelsP90', 0.3),
      higher('aerialDuelWinRate', 0.3),
      higher('touchesBoxP90', 0.2),
      higher('goalsP90', 0.2),
    ],
  },
  {
    key: 'deep-lying-forward',
    name: 'Deep-Lying Forward',
    positionGroup: 'FW',
    description: 'Drops in to link play and create for runners.',
    minMinutes: 450,
    requirements: [
      higher('xaP90', 0.25),
      higher('keyPassesP90', 0.25),
      higher('passesP90', 0.2),
      higher('passAccuracy', 0.15),
      higher('touchesP90', 0.15),
    ],
  },
  {
    key: 'complete-forward',
    name: 'Complete Forward',
    positionGroup: 'FW',
    description: 'Scores, creates, presses and holds the ball up.',
    minMinutes: 450,
    requirements: [
      higher('xgP90', 0.25),
      higher('xaP90', 0.2),
      higher('aerialDuelWinRate', 0.15),
      higher('pressuresP90', 0.15),
      higher('touchesBoxP90', 0.15),
      higher('dribblesP90', 0.1),
    ],
  },
  {
    key: 'ball-playing-centre-back',
    name: 'Ball-Playing Centre Back',
    positionGroup: 'DF',
    description: 'Starts attacks: progressive passing from the back line.',
    minMinutes: 450,
    requirements: [
      higher('progressivePassesP90', 0.3),
      higher('passAccuracy', 0.25),
      higher('passesP90', 0.15),
      higher('longPassesP90', 0.15),
      higher('progressiveCarriesP90', 0.15),
    ],
  },
  {
    key: 'stopper-centre-back',
    name: 'Stopper Centre Back',
    positionGroup: 'DF',
    description: 'Aggressive front-foot defending, dominant in duels.',
    minMinutes: 450,
    requirements: [
      higher('aerialDuelWinRate', 0.25),
      higher('aerialDuelsP90', 0.15),
      higher('tacklesP90', 0.2),
      higher('interceptionsP90', 0.2),
      higher('clearancesP90', 0.1),
      higher('blocksP90', 0.1),
    ],
  },
  {
    key: 'defensive-full-back',
    name: 'Defensive Full Back',
    positionGroup: 'DF',
    description: 'Defends the flank first; conservative in possession.',
    minMinutes: 450,
    requirements: [
      higher('tacklesP90', 0.25),
      higher('interceptionsP90', 0.25),
      higher('defensiveDuelWinRate', 0.25),
      higher('clearancesP90', 0.15),
      higher('passAccuracy', 0.1),
    ],
  },
  {
    key: 'overlapping-full-back',
    name: 'Overlapping Full Back',
    positionGroup: 'DF',
    description: 'Provides width and delivery high up the flank.',
    minMinutes: 450,
    requirements: [
      higher('crossesP90', 0.3),
      higher('progressiveCarriesP90', 0.2),
      higher('touchesFinalThirdP90', 0.2),
      higher('xaP90', 0.15),
      higher('distanceP90', 0.15),
    ],
  },
  {
    key: 'inverted-full-back',
    name: 'Inverted Full Back',
    positionGroup: 'DF',
    description: 'Steps into midfield to build; passing over delivery.',
    minMinutes: 450,
    requirements: [
      higher('passesP90', 0.25),
      higher('passAccuracy', 0.25),
      higher('progressivePassesP90', 0.25),
      higher('interceptionsP90', 0.15),
      higher('touchesP90', 0.1),
    ],
  },
];

export interface RoleScoreInput {
  /** metricKey -> { value, population } for the player being scored. */
  metrics: Record<string, { value: number | null; population: number[] }>;
  minutes: number;
}

export interface RoleContribution {
  metricKey: string;
  value: number;
  percentile: number;
  weight: number;
  contribution: number;
  direction: RoleRequirement['direction'];
  meetsMinimum: boolean;
}

export interface RoleScoreResult {
  roleKey: string;
  roleName: string;
  score: number;
  coverage: number;
  meetsMinutes: boolean;
  breakdown: RoleContribution[];
}

const round = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Score one player against one role.
 *
 * Every requirement contributes its percentile times its weight; weights of
 * metrics without data are excluded and the rest renormalised. The full
 * breakdown is returned so the score can always be explained (§85).
 */
export function scoreRole(
  role: Pick<RoleDefinition, 'key' | 'name' | 'minMinutes'> & { requirements: RoleRequirement[] },
  input: RoleScoreInput,
): RoleScoreResult {
  const breakdown: RoleContribution[] = [];
  let weighted = 0;
  let usedWeight = 0;
  let definedWeight = 0;

  for (const requirement of role.requirements) {
    definedWeight += requirement.weight;
    const metric = input.metrics[requirement.metricKey];
    if (!metric || metric.value === null || metric.population.length === 0) continue;

    const raw = percentileRank(metric.value, metric.population);
    const percentile = requirement.direction === 'LOWER_BETTER' ? round(100 - raw) : raw;

    weighted += percentile * requirement.weight;
    usedWeight += requirement.weight;

    breakdown.push({
      metricKey: requirement.metricKey,
      value: metric.value,
      percentile,
      weight: requirement.weight,
      contribution: round(percentile * requirement.weight, 2),
      direction: requirement.direction,
      meetsMinimum:
        requirement.minPercentile === undefined || percentile >= requirement.minPercentile,
    });
  }

  return {
    roleKey: role.key,
    roleName: role.name,
    score: usedWeight > 0 ? round(weighted / usedWeight) : 0,
    coverage: definedWeight > 0 ? round(usedWeight / definedWeight, 2) : 0,
    meetsMinutes: input.minutes >= role.minMinutes,
    breakdown: breakdown.sort((a, b) => b.contribution - a.contribution),
  };
}

export interface RoleProfile {
  primary: RoleScoreResult | null;
  secondary: RoleScoreResult[];
  /** 0-1: how clearly the primary role stands out from the alternatives. */
  confidence: number;
  all: RoleScoreResult[];
}

/**
 * Rank a player across a set of roles.
 *
 * Confidence combines the margin over the runner-up with data coverage, so a
 * player scored on half the required metrics never looks certain.
 */
export function rankRoles(
  roles: readonly (Pick<RoleDefinition, 'key' | 'name' | 'minMinutes'> & {
    requirements: RoleRequirement[];
  })[],
  input: RoleScoreInput,
): RoleProfile {
  const scored = roles
    .map((role) => scoreRole(role, input))
    .sort((a, b) => b.score - a.score);

  const primary = scored[0] ?? null;
  const runnerUp = scored[1];

  let confidence = 0;
  if (primary) {
    const margin = runnerUp ? Math.max(0, primary.score - runnerUp.score) : primary.score;
    confidence = round(Math.min(1, (margin / 20) * 0.6 + primary.coverage * 0.4), 2);
  }

  return {
    primary,
    secondary: scored.slice(1, 4),
    confidence,
    all: scored,
  };
}
