import { PITCH_LENGTH_M, type Point } from '@/analytics/coordinates';

/**
 * Tracking engine (§37).
 *
 * Turns frames into tactical aggregates. The browser never receives frames
 * (§59, §92) - it receives what this module produces.
 */

export interface TrackedPlayer {
  playerId: string | null;
  teamId: string | null;
  x: number;
  y: number;
  speedMs?: number | null;
}

export interface TrackingFrameInput {
  timestampMs: number;
  period: number;
  ballInPlay: boolean;
  possessionTeamId: string | null;
  players: TrackedPlayer[];
}

export interface TeamShapeAggregate {
  teamId: string;
  phase: 'ALL' | 'IN_POSSESSION' | 'OUT_OF_POSSESSION';
  frames: number;
  centroidX: number;
  centroidY: number;
  teamWidthM: number;
  teamDepthM: number;
  compactness: number;
  convexHullAreaM2: number;
  defensiveLineM: number;
  attackingLineM: number;
  lineDistanceM: number;
}

export interface PlayerPositionAggregate {
  playerId: string;
  teamId: string | null;
  phase: TeamShapeAggregate['phase'];
  frames: number;
  avgX: number;
  avgY: number;
  distanceM: number;
  highSpeedDistanceM: number;
  sprintCount: number;
  maxSpeedMs: number;
}

const HIGH_SPEED_MS = 5.5;
const SPRINT_MS = 7.0;

const round = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** Convex hull area via the monotone chain algorithm and the shoelace formula. */
export function convexHullArea(points: readonly Point[]): number {
  if (points.length < 3) return 0;

  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (input: Point[]): Point[] => {
    const stack: Point[] = [];
    for (const point of input) {
      while (
        stack.length >= 2 &&
        cross(stack[stack.length - 2] as Point, stack[stack.length - 1] as Point, point) <= 0
      ) {
        stack.pop();
      }
      stack.push(point);
    }
    stack.pop();
    return stack;
  };

  const hull = [...build(sorted), ...build([...sorted].reverse())];
  if (hull.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < hull.length; i += 1) {
    const current = hull[i] as Point;
    const next = hull[(i + 1) % hull.length] as Point;
    area += current.x * next.y - next.x * current.y;
  }
  return round(Math.abs(area) / 2);
}

const phaseOf = (
  frame: TrackingFrameInput,
  teamId: string,
): TeamShapeAggregate['phase'] =>
  frame.possessionTeamId === null
    ? 'ALL'
    : frame.possessionTeamId === teamId
      ? 'IN_POSSESSION'
      : 'OUT_OF_POSSESSION';

/**
 * Team shape per phase.
 *
 * Frames with the ball out of play are excluded: a throw-in queue is not a
 * defensive block, and including it distorts every shape metric.
 */
export function aggregateTeamShape(
  frames: readonly TrackingFrameInput[],
  teamId: string,
): TeamShapeAggregate[] {
  const phases: TeamShapeAggregate['phase'][] = ['ALL', 'IN_POSSESSION', 'OUT_OF_POSSESSION'];
  const results: TeamShapeAggregate[] = [];

  for (const phase of phases) {
    const samples = frames.filter((frame) => {
      if (!frame.ballInPlay) return false;
      if (phase === 'ALL') return true;
      return phaseOf(frame, teamId) === phase;
    });

    if (samples.length === 0) continue;

    const centroidsX: number[] = [];
    const centroidsY: number[] = [];
    const widths: number[] = [];
    const depths: number[] = [];
    const hulls: number[] = [];
    const defensiveLines: number[] = [];
    const attackingLines: number[] = [];

    for (const frame of samples) {
      const players = frame.players.filter((player) => player.teamId === teamId);
      if (players.length < 3) continue;

      const xs = players.map((player) => player.x);
      const ys = players.map((player) => player.y);

      centroidsX.push(mean(xs));
      centroidsY.push(mean(ys));
      widths.push(Math.max(...ys) - Math.min(...ys));
      depths.push(Math.max(...xs) - Math.min(...xs));
      defensiveLines.push(Math.min(...xs));
      attackingLines.push(Math.max(...xs));
      hulls.push(convexHullArea(players.map((player) => ({ x: player.x, y: player.y }))));
    }

    if (centroidsX.length === 0) continue;

    const width = round(mean(widths));
    const depth = round(mean(depths));
    const defensiveLine = round(mean(defensiveLines));
    const attackingLine = round(mean(attackingLines));

    results.push({
      teamId,
      phase,
      frames: centroidsX.length,
      centroidX: round(mean(centroidsX)),
      centroidY: round(mean(centroidsY)),
      teamWidthM: width,
      teamDepthM: depth,
      // Compactness: area covered relative to the whole pitch, inverted so a
      // higher number means a more compact team.
      compactness: round(
        Math.max(0, 100 - (mean(hulls) / (PITCH_LENGTH_M * 68)) * 100),
        1,
      ),
      convexHullAreaM2: round(mean(hulls)),
      defensiveLineM: defensiveLine,
      attackingLineM: attackingLine,
      lineDistanceM: round(attackingLine - defensiveLine),
    });
  }

  return results;
}

/**
 * Physical and positional aggregates per player (§25 Physical).
 *
 * Distance is integrated from frame-to-frame displacement; implausible jumps
 * (tracking glitches) are discarded rather than inflating the totals.
 */
export function aggregatePlayers(
  frames: readonly TrackingFrameInput[],
  frameRateHz: number,
): PlayerPositionAggregate[] {
  const dt = 1 / Math.max(1, frameRateHz);
  const maxStepM = 12 * dt; // 12 m/s is beyond human sprint speed.

  interface Accumulator extends PlayerPositionAggregate {
    lastX: number | null;
    lastY: number | null;
    sprinting: boolean;
  }

  const byPlayer = new Map<string, Accumulator>();

  for (const frame of frames) {
    for (const player of frame.players) {
      if (!player.playerId) continue;

      let entry = byPlayer.get(player.playerId);
      if (!entry) {
        entry = {
          playerId: player.playerId,
          teamId: player.teamId,
          phase: 'ALL',
          frames: 0,
          avgX: 0,
          avgY: 0,
          distanceM: 0,
          highSpeedDistanceM: 0,
          sprintCount: 0,
          maxSpeedMs: 0,
          lastX: null,
          lastY: null,
          sprinting: false,
        };
        byPlayer.set(player.playerId, entry);
      }

      entry.frames += 1;
      entry.avgX += player.x;
      entry.avgY += player.y;

      if (entry.lastX !== null && entry.lastY !== null) {
        const step = Math.hypot(player.x - entry.lastX, player.y - entry.lastY);
        if (step <= maxStepM) {
          const speed = player.speedMs ?? step / dt;
          entry.distanceM += step;
          if (speed >= HIGH_SPEED_MS) entry.highSpeedDistanceM += step;
          if (speed > entry.maxSpeedMs) entry.maxSpeedMs = speed;

          // Count a sprint once per continuous period above the threshold.
          if (speed >= SPRINT_MS && !entry.sprinting) {
            entry.sprintCount += 1;
            entry.sprinting = true;
          } else if (speed < SPRINT_MS) {
            entry.sprinting = false;
          }
        }
      }

      entry.lastX = player.x;
      entry.lastY = player.y;
    }
  }

  return [...byPlayer.values()].map((entry) => ({
    playerId: entry.playerId,
    teamId: entry.teamId,
    phase: entry.phase,
    frames: entry.frames,
    avgX: round(entry.frames > 0 ? entry.avgX / entry.frames : 0),
    avgY: round(entry.frames > 0 ? entry.avgY / entry.frames : 0),
    distanceM: round(entry.distanceM),
    highSpeedDistanceM: round(entry.highSpeedDistanceM),
    sprintCount: entry.sprintCount,
    maxSpeedMs: round(entry.maxSpeedMs),
  }));
}
