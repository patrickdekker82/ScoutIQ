import { PITCH_LENGTH_M, PITCH_WIDTH_M, type Point } from '@/analytics/coordinates';

/**
 * Zone engine (§36).
 *
 * Two schemes, both computed from the same canonical coordinates:
 *   THIRDS_LANES - 3 horizontal thirds x 5 vertical lanes (the tactical
 *                  vocabulary most analysts actually speak)
 *   GRID_5X4     - 5 columns x 4 rows, for finer zone statistics
 */

export type ZoneScheme = 'THIRDS_LANES' | 'GRID_5X4';

export interface Zone {
  scheme: ZoneScheme;
  key: string;
  row: number;
  col: number;
  label: string;
}

const THIRD_LABELS = ['Defensive', 'Middle', 'Attacking'] as const;
const LANE_LABELS = ['Left', 'Left half-space', 'Centre', 'Right half-space', 'Right'] as const;

const bucket = (value: number, size: number, count: number): number =>
  Math.min(count - 1, Math.max(0, Math.floor((value / size) * count)));

export function zoneFor(point: Point, scheme: ZoneScheme = 'THIRDS_LANES'): Zone {
  if (scheme === 'THIRDS_LANES') {
    const col = bucket(point.x, PITCH_LENGTH_M, 3);
    const row = bucket(point.y, PITCH_WIDTH_M, 5);
    return {
      scheme,
      key: `${THIRD_LABELS[col]}/${LANE_LABELS[row]}`,
      row,
      col,
      label: `${THIRD_LABELS[col]} third, ${LANE_LABELS[row]}`,
    };
  }

  const col = bucket(point.x, PITCH_LENGTH_M, 5);
  const row = bucket(point.y, PITCH_WIDTH_M, 4);
  return {
    scheme,
    key: `C${col + 1}R${row + 1}`,
    row,
    col,
    label: `Column ${col + 1}, row ${row + 1}`,
  };
}

export function allZones(scheme: ZoneScheme = 'THIRDS_LANES'): Zone[] {
  const cols = scheme === 'THIRDS_LANES' ? 3 : 5;
  const rows = scheme === 'THIRDS_LANES' ? 5 : 4;
  const zones: Zone[] = [];

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const colSize = PITCH_LENGTH_M / cols;
      const rowSize = PITCH_WIDTH_M / rows;
      zones.push(
        zoneFor({ x: colSize * (col + 0.5), y: rowSize * (row + 0.5) }, scheme),
      );
    }
  }
  return zones;
}

export interface ZoneCounters {
  touches: number;
  passes: number;
  carries: number;
  shots: number;
  defensiveActions: number;
  pressures: number;
  possessionTimeSec: number;
}

export const emptyCounters = (): ZoneCounters => ({
  touches: 0,
  passes: 0,
  carries: 0,
  shots: 0,
  defensiveActions: 0,
  pressures: 0,
  possessionTimeSec: 0,
});

export interface ZoneActivity extends ZoneCounters {
  scheme: ZoneScheme;
  zoneKey: string;
  zoneRow: number;
  zoneCol: number;
}

export interface ZoneInputEvent {
  x: number | null | undefined;
  y: number | null | undefined;
  kind: keyof Omit<ZoneCounters, 'possessionTimeSec'>;
  durationSec?: number;
}

/** Aggregate events into zone activity. Events without coordinates are ignored. */
export function aggregateZones(
  events: readonly ZoneInputEvent[],
  scheme: ZoneScheme = 'THIRDS_LANES',
): ZoneActivity[] {
  const byZone = new Map<string, ZoneActivity>();

  for (const event of events) {
    if (event.x == null || event.y == null) continue;
    const zone = zoneFor({ x: event.x, y: event.y }, scheme);

    let activity = byZone.get(zone.key);
    if (!activity) {
      activity = { scheme, zoneKey: zone.key, zoneRow: zone.row, zoneCol: zone.col, ...emptyCounters() };
      byZone.set(zone.key, activity);
    }

    activity[event.kind] += 1;
    if (event.durationSec) activity.possessionTimeSec += event.durationSec;
  }

  return [...byZone.values()].sort((a, b) => a.zoneCol - b.zoneCol || a.zoneRow - b.zoneRow);
}
