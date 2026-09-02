/**
 * Pure analytics functions.
 *
 * Deliberately free of I/O: they take plain objects and return plain objects.
 * That keeps the analytics layer runnable inside the API process, inside a
 * dedicated worker container, or on a completely separate machine - which is
 * what makes future horizontal scaling possible without a rewrite.
 */

export interface MatchStatLike {
  minutesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  xg: number;
  xa: number;
  passes: number;
  passesCompleted: number;
  progressivePasses: number;
  duelsWon: number;
  duelsTotal: number;
}

export interface PlayerAggregate {
  matches: number;
  minutesPlayed: number;
  goalsPer90: number;
  assistsPer90: number;
  xgPer90: number;
  xaPer90: number;
  passAccuracy: number;
  progPassPer90: number;
  duelWinRate: number;
}

const MINUTES_PER_MATCH = 90;

const round = (value: number, decimals = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

/** Per-90 normalisation. Returns 0 for players without minutes. */
export function per90(total: number, minutesPlayed: number): number {
  if (minutesPlayed <= 0) return 0;
  return round((total / minutesPlayed) * MINUTES_PER_MATCH);
}

export function aggregatePlayerStats(stats: readonly MatchStatLike[]): PlayerAggregate {
  const totals = stats.reduce(
    (acc, stat) => ({
      minutesPlayed: acc.minutesPlayed + stat.minutesPlayed,
      goals: acc.goals + stat.goals,
      assists: acc.assists + stat.assists,
      xg: acc.xg + stat.xg,
      xa: acc.xa + stat.xa,
      passes: acc.passes + stat.passes,
      passesCompleted: acc.passesCompleted + stat.passesCompleted,
      progressivePasses: acc.progressivePasses + stat.progressivePasses,
      duelsWon: acc.duelsWon + stat.duelsWon,
      duelsTotal: acc.duelsTotal + stat.duelsTotal,
    }),
    {
      minutesPlayed: 0,
      goals: 0,
      assists: 0,
      xg: 0,
      xa: 0,
      passes: 0,
      passesCompleted: 0,
      progressivePasses: 0,
      duelsWon: 0,
      duelsTotal: 0,
    },
  );

  return {
    matches: stats.length,
    minutesPlayed: totals.minutesPlayed,
    goalsPer90: per90(totals.goals, totals.minutesPlayed),
    assistsPer90: per90(totals.assists, totals.minutesPlayed),
    xgPer90: per90(totals.xg, totals.minutesPlayed),
    xaPer90: per90(totals.xa, totals.minutesPlayed),
    passAccuracy: round(ratio(totals.passesCompleted, totals.passes)),
    progPassPer90: per90(totals.progressivePasses, totals.minutesPlayed),
    duelWinRate: round(ratio(totals.duelsWon, totals.duelsTotal)),
  };
}

/**
 * Percentile rank of `value` within `population` (0-100, inclusive-of-equal).
 * An empty population yields 0 so a single-player database stays well defined.
 */
export function percentileRank(value: number, population: readonly number[]): number {
  if (population.length === 0) return 0;
  const atOrBelow = population.filter((candidate) => candidate <= value).length;
  return round((atOrBelow / population.length) * 100, 1);
}

/** Weight of each aggregate in the composite scout score, per position group. */
const WEIGHTS: Record<string, Partial<Record<keyof PlayerAggregate, number>>> = {
  GK: { duelWinRate: 0.4, passAccuracy: 0.4, progPassPer90: 0.2 },
  DF: { duelWinRate: 0.35, passAccuracy: 0.25, progPassPer90: 0.25, xaPer90: 0.15 },
  MF: { progPassPer90: 0.3, passAccuracy: 0.2, xaPer90: 0.2, xgPer90: 0.15, duelWinRate: 0.15 },
  FW: { xgPer90: 0.35, goalsPer90: 0.3, xaPer90: 0.2, duelWinRate: 0.15 },
};

export const POSITION_GROUPS = Object.keys(WEIGHTS);

/** Map a free-form position string onto a position group. */
export function positionGroup(position: string): string {
  const normalised = position.trim().toUpperCase();
  if (/^(GK|GOAL)/.test(normalised)) return 'GK';
  if (/^(CB|LB|RB|LWB|RWB|DF|DEF)/.test(normalised)) return 'DF';
  if (/^(CDM|CM|CAM|DM|AM|LM|RM|MF|MID)/.test(normalised)) return 'MF';
  if (/^(LW|RW|CF|ST|FW|FOR|WING)/.test(normalised)) return 'FW';
  return 'MF';
}

export interface ScoutScoreInput {
  position: string;
  aggregate: PlayerAggregate;
  /** Aggregates of every comparable player (same position group + season). */
  population: readonly PlayerAggregate[];
}

/**
 * Composite 0-100 score: each weighted metric is converted to a percentile
 * within the comparison population, then combined. Percentiles keep the score
 * meaningful regardless of league, season or provider scale.
 */
export function scoutScore({ position, aggregate, population }: ScoutScoreInput): number {
  const weights = WEIGHTS[positionGroup(position)] ?? WEIGHTS.MF!;
  let total = 0;
  let weightSum = 0;

  for (const [metric, weight] of Object.entries(weights) as [keyof PlayerAggregate, number][]) {
    const values = population.map((entry) => entry[metric] as number);
    total += percentileRank(aggregate[metric] as number, values) * weight;
    weightSum += weight;
  }

  if (weightSum === 0) return 0;
  return round(total / weightSum, 1);
}
