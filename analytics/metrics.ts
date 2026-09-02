import { EventType } from '@prisma/client';
import {
  distanceToGoal,
  isInBox,
  isInFinalThird,
  isProgressive,
  type Point,
} from '@/analytics/coordinates';
import { per90 } from '@/analytics/normalize';

/**
 * Player metric engine (§25, §83).
 *
 * Metrics are derived from canonical events. The guiding rule from §92 is
 * "do not fabricate unavailable metrics": a metric whose source events are
 * absent stays absent (null), it does not silently become zero. `available`
 * records which families the source data actually supported.
 */

export interface MetricEventInput {
  type: EventType;
  playerId: string | null;
  teamId: string | null;
  x: number | null;
  y: number | null;
  endX: number | null;
  endY: number | null;
  outcome: string | null;
  underPressure: boolean;
  durationSec: number | null;
  pass?: {
    completed: boolean;
    isCross: boolean;
    isSwitch: boolean;
    isThroughBall: boolean;
    isProgressive: boolean;
    intoFinalThird: boolean;
    intoBox: boolean;
    isKeyPass: boolean;
    isAssist: boolean;
    lengthM: number;
    xa: number | null;
  } | null;
  shot?: {
    xg: number;
    onTarget: boolean;
    isGoal: boolean;
    isPenalty: boolean;
    blocked: boolean;
  } | null;
  carry?: {
    isProgressive: boolean;
    intoFinalThird: boolean;
    intoBox: boolean;
    distanceM: number;
  } | null;
  dribble?: { completed: boolean } | null;
  duel?: { duelType: string; won: boolean } | null;
  tackle?: { won: boolean } | null;
  pressure?: { counterpress: boolean } | null;
  recovery?: { failed: boolean } | null;
}

export interface PlayerMatchMetrics {
  minutes: number;

  passes: number;
  passesCompleted: number;
  passAccuracy: number;
  progressivePasses: number;
  passesFinalThird: number;
  passesIntoBox: number;
  keyPasses: number;
  throughBalls: number;
  switches: number;
  crosses: number;
  longPasses: number;

  carries: number;
  progressiveCarries: number;
  carriesFinalThird: number;
  carriesIntoBox: number;
  dribbles: number;
  dribblesCompleted: number;
  progressiveActions: number;

  xa: number;
  chancesCreated: number;
  touches: number;
  touchesFinalThird: number;
  touchesBox: number;

  shots: number;
  shotsOnTarget: number;
  goals: number;
  xg: number;
  npxg: number;
  xgPerShot: number;
  assists: number;

  tackles: number;
  tacklesWon: number;
  interceptions: number;
  pressures: number;
  counterpressures: number;
  recoveries: number;
  blocks: number;
  clearances: number;
  defensiveDuels: number;
  defensiveDuelsWon: number;
  aerialDuels: number;
  aerialDuelsWon: number;
  foulsCommitted: number;

  /// Which metric families the source data actually supported (§54, §92).
  available: MetricAvailability;
}

export interface MetricAvailability {
  passing: boolean;
  shooting: boolean;
  carrying: boolean;
  defending: boolean;
  pressing: boolean;
  duels: boolean;
  physical: boolean;
}

const LONG_PASS_M = 30;

const point = (x: number | null, y: number | null): Point | null =>
  x == null || y == null ? null : { x, y };

export function emptyMetrics(minutes = 0): PlayerMatchMetrics {
  return {
    minutes,
    passes: 0,
    passesCompleted: 0,
    passAccuracy: 0,
    progressivePasses: 0,
    passesFinalThird: 0,
    passesIntoBox: 0,
    keyPasses: 0,
    throughBalls: 0,
    switches: 0,
    crosses: 0,
    longPasses: 0,
    carries: 0,
    progressiveCarries: 0,
    carriesFinalThird: 0,
    carriesIntoBox: 0,
    dribbles: 0,
    dribblesCompleted: 0,
    progressiveActions: 0,
    xa: 0,
    chancesCreated: 0,
    touches: 0,
    touchesFinalThird: 0,
    touchesBox: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    xg: 0,
    npxg: 0,
    xgPerShot: 0,
    assists: 0,
    tackles: 0,
    tacklesWon: 0,
    interceptions: 0,
    pressures: 0,
    counterpressures: 0,
    recoveries: 0,
    blocks: 0,
    clearances: 0,
    defensiveDuels: 0,
    defensiveDuelsWon: 0,
    aerialDuels: 0,
    aerialDuelsWon: 0,
    foulsCommitted: 0,
    available: {
      passing: false,
      shooting: false,
      carrying: false,
      defending: false,
      pressing: false,
      duels: false,
      physical: false,
    },
  };
}

const round = (value: number, decimals = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Derive one player's metrics for one match from that player's events. */
export function computePlayerMatchMetrics(
  events: readonly MetricEventInput[],
  minutes: number,
): PlayerMatchMetrics {
  const m = emptyMetrics(minutes);

  for (const event of events) {
    const from = point(event.x, event.y);
    const to = point(event.endX, event.endY);

    // Every on-ball event is a touch.
    if (
      event.type === EventType.PASS ||
      event.type === EventType.SHOT ||
      event.type === EventType.CARRY ||
      event.type === EventType.DRIBBLE ||
      event.type === EventType.TOUCH ||
      event.type === EventType.CLEARANCE
    ) {
      m.touches += 1;
      if (from && isInFinalThird(from)) m.touchesFinalThird += 1;
      if (from && isInBox(from)) m.touchesBox += 1;
    }

    switch (event.type) {
      case EventType.PASS: {
        m.available.passing = true;
        m.passes += 1;
        const pass = event.pass;
        const completed = pass?.completed ?? event.outcome !== 'INCOMPLETE';
        if (completed) m.passesCompleted += 1;

        const progressive =
          pass?.isProgressive ?? (from && to ? isProgressive(from, to) : false);
        if (progressive && completed) {
          m.progressivePasses += 1;
          m.progressiveActions += 1;
        }
        if ((pass?.intoFinalThird ?? (to ? isInFinalThird(to) : false)) && completed) {
          m.passesFinalThird += 1;
        }
        if ((pass?.intoBox ?? (to ? isInBox(to) : false)) && completed) m.passesIntoBox += 1;
        if (pass?.isKeyPass) {
          m.keyPasses += 1;
          m.chancesCreated += 1;
        }
        if (pass?.isAssist) m.assists += 1;
        if (pass?.isThroughBall) m.throughBalls += 1;
        if (pass?.isSwitch) m.switches += 1;
        if (pass?.isCross) m.crosses += 1;
        if ((pass?.lengthM ?? 0) >= LONG_PASS_M) m.longPasses += 1;
        if (pass?.xa) m.xa += pass.xa;
        break;
      }

      case EventType.SHOT: {
        m.available.shooting = true;
        m.shots += 1;
        const shot = event.shot;
        if (shot) {
          m.xg += shot.xg;
          if (!shot.isPenalty) m.npxg += shot.xg;
          if (shot.onTarget) m.shotsOnTarget += 1;
          if (shot.isGoal) m.goals += 1;
        }
        break;
      }

      case EventType.CARRY: {
        m.available.carrying = true;
        m.carries += 1;
        const carry = event.carry;
        const progressive =
          carry?.isProgressive ?? (from && to ? isProgressive(from, to) : false);
        if (progressive) {
          m.progressiveCarries += 1;
          m.progressiveActions += 1;
        }
        if (carry?.intoFinalThird ?? (to ? isInFinalThird(to) : false)) m.carriesFinalThird += 1;
        if (carry?.intoBox ?? (to ? isInBox(to) : false)) m.carriesIntoBox += 1;
        break;
      }

      case EventType.DRIBBLE: {
        m.available.carrying = true;
        m.dribbles += 1;
        if (event.dribble?.completed ?? event.outcome === 'COMPLETE') m.dribblesCompleted += 1;
        break;
      }

      case EventType.TACKLE: {
        m.available.defending = true;
        m.tackles += 1;
        if (event.tackle?.won) m.tacklesWon += 1;
        break;
      }

      case EventType.INTERCEPTION:
        m.available.defending = true;
        m.interceptions += 1;
        break;

      case EventType.PRESSURE:
        m.available.pressing = true;
        m.pressures += 1;
        if (event.pressure?.counterpress) m.counterpressures += 1;
        break;

      case EventType.RECOVERY:
        m.available.defending = true;
        if (!event.recovery?.failed) m.recoveries += 1;
        break;

      case EventType.BLOCK:
        m.available.defending = true;
        m.blocks += 1;
        break;

      case EventType.CLEARANCE:
        m.available.defending = true;
        m.clearances += 1;
        break;

      case EventType.FOUL:
        m.foulsCommitted += 1;
        break;

      case EventType.DUEL: {
        m.available.duels = true;
        const duel = event.duel;
        if (duel?.duelType === 'AERIAL') {
          m.aerialDuels += 1;
          if (duel.won) m.aerialDuelsWon += 1;
        } else {
          m.defensiveDuels += 1;
          if (duel?.won) m.defensiveDuelsWon += 1;
        }
        break;
      }

      default:
        break;
    }
  }

  m.passAccuracy = m.passes > 0 ? round(m.passesCompleted / m.passes) : 0;
  m.xgPerShot = m.shots > 0 ? round(m.xg / m.shots) : 0;
  m.xg = round(m.xg);
  m.npxg = round(m.npxg);
  m.xa = round(m.xa);

  return m;
}

export interface SeasonAggregate extends Omit<PlayerMatchMetrics, 'minutes'> {
  minutes: number;
  matches: number;
  starts: number;
}

/** Sum match metrics into a season total. */
export function aggregateSeason(
  matches: readonly { metrics: PlayerMatchMetrics; isStarter: boolean }[],
): SeasonAggregate {
  const total = emptyMetrics(0) as SeasonAggregate;
  total.matches = 0;
  total.starts = 0;

  const numericKeys = Object.keys(total).filter(
    (key) => typeof (total as unknown as Record<string, unknown>)[key] === 'number',
  ) as (keyof SeasonAggregate)[];

  for (const entry of matches) {
    total.matches += 1;
    if (entry.isStarter) total.starts += 1;

    for (const key of numericKeys) {
      if (key === 'matches' || key === 'starts') continue;
      (total[key] as number) += (entry.metrics[key as keyof PlayerMatchMetrics] as number) ?? 0;
    }

    for (const family of Object.keys(total.available) as (keyof MetricAvailability)[]) {
      total.available[family] ||= entry.metrics.available[family];
    }
  }

  total.passAccuracy = total.passes > 0 ? round(total.passesCompleted / total.passes) : 0;
  total.xgPerShot = total.shots > 0 ? round(total.xg / total.shots) : 0;

  return total;
}

/** The per-90 view of a season aggregate, as stored in player_season_metrics. */
export function seasonPer90(aggregate: SeasonAggregate) {
  const minutes = aggregate.minutes;
  const rate = (total: number): number => per90(total, minutes);

  return {
    passesP90: rate(aggregate.passes),
    passAccuracy: aggregate.passAccuracy,
    progressivePassesP90: rate(aggregate.progressivePasses),
    passesFinalThirdP90: rate(aggregate.passesFinalThird),
    passesIntoBoxP90: rate(aggregate.passesIntoBox),
    keyPassesP90: rate(aggregate.keyPasses),
    crossesP90: rate(aggregate.crosses),
    longPassesP90: rate(aggregate.longPasses),

    progressiveCarriesP90: rate(aggregate.progressiveCarries),
    carriesFinalThirdP90: rate(aggregate.carriesFinalThird),
    carriesIntoBoxP90: rate(aggregate.carriesIntoBox),
    dribblesP90: rate(aggregate.dribbles),
    dribbleSuccessRate:
      aggregate.dribbles > 0 ? round(aggregate.dribblesCompleted / aggregate.dribbles) : 0,
    progressiveActionsP90: rate(aggregate.progressiveActions),

    xaP90: rate(aggregate.xa),
    chancesCreatedP90: rate(aggregate.chancesCreated),
    touchesP90: rate(aggregate.touches),
    touchesFinalThirdP90: rate(aggregate.touchesFinalThird),
    touchesBoxP90: rate(aggregate.touchesBox),

    shotsP90: rate(aggregate.shots),
    shotsOnTargetP90: rate(aggregate.shotsOnTarget),
    goalsP90: rate(aggregate.goals),
    xgP90: rate(aggregate.xg),
    npxgP90: rate(aggregate.npxg),
    xgPerShot: aggregate.xgPerShot,
    assistsP90: rate(aggregate.assists),

    tacklesP90: rate(aggregate.tackles),
    tackleSuccessRate:
      aggregate.tackles > 0 ? round(aggregate.tacklesWon / aggregate.tackles) : 0,
    interceptionsP90: rate(aggregate.interceptions),
    pressuresP90: rate(aggregate.pressures),
    counterpressuresP90: rate(aggregate.counterpressures),
    recoveriesP90: rate(aggregate.recoveries),
    blocksP90: rate(aggregate.blocks),
    clearancesP90: rate(aggregate.clearances),
    defensiveDuelsP90: rate(aggregate.defensiveDuels),
    defensiveDuelWinRate:
      aggregate.defensiveDuels > 0
        ? round(aggregate.defensiveDuelsWon / aggregate.defensiveDuels)
        : 0,
    aerialDuelsP90: rate(aggregate.aerialDuels),
    aerialDuelWinRate:
      aggregate.aerialDuels > 0 ? round(aggregate.aerialDuelsWon / aggregate.aerialDuels) : 0,
  };
}

/** Simple geometric xG fallback for providers that ship no xG (§92). */
export function estimateXg(shot: Point, isHeader = false, isPenalty = false): number {
  if (isPenalty) return 0.76;
  const distance = distanceToGoal(shot);
  const base = Math.exp(-0.11 * distance);
  const value = isHeader ? base * 0.55 : base;
  return round(Math.min(0.95, Math.max(0.01, value)));
}
