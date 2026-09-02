import { describe, expect, it } from 'vitest';
import { applyHeatmapFilters, buildHeatmap } from '@/analytics/heatmap';
import { aggregateZones, allZones, zoneFor } from '@/analytics/zones';
import { aggregatePlayers, aggregateTeamShape, convexHullArea } from '@/analytics/tracking';

/** Heatmap engine (§34, §35). */
describe('buildHeatmap', () => {
  const cluster = Array.from({ length: 40 }, () => ({ x: 90 + Math.random() * 4, y: 34 }));

  it('bins events into a grid whose peak is where the events are', () => {
    const result = buildHeatmap(cluster, { algorithm: 'GRID_DENSITY', cols: 12, rows: 8 });

    expect(result.cells).toHaveLength(96);
    expect(result.sampleSize).toBe(40);

    const hottest = [...result.cells].sort((a, b) => b.value - a.value)[0]!;
    expect(hottest.x).toBeGreaterThan(80);
    expect(hottest.value).toBe(1);
  });

  it('spreads influence with a Gaussian kernel', () => {
    const grid = buildHeatmap([{ x: 52.5, y: 34 }], {
      algorithm: 'GAUSSIAN_KDE',
      cols: 20,
      rows: 14,
      bandwidth: 8,
    });

    const warm = grid.cells.filter((cell) => cell.value > 0.05);
    // A single point influences more than one cell, unlike plain binning.
    expect(warm.length).toBeGreaterThan(1);
    expect(grid.bandwidth).toBe(8);
  });

  it('offsets alternate hexbin rows', () => {
    const result = buildHeatmap(cluster, { algorithm: 'HEXBIN', cols: 10, rows: 6 });
    const row0 = result.cells.filter((cell) => cell.row === 0).map((cell) => cell.x);
    const row1 = result.cells.filter((cell) => cell.row === 1).map((cell) => cell.x);
    expect(row0[0]).not.toBe(row1[0]);
  });

  it('weights by xG when asked, so danger beats volume', () => {
    const result = buildHeatmap(
      [
        { x: 95, y: 34, weight: 0.6 },
        { x: 70, y: 34, weight: 0.02 },
      ],
      { algorithm: 'GRID_DENSITY', cols: 10, rows: 6 },
    );

    const hottest = [...result.cells].sort((a, b) => b.value - a.value)[0]!;
    expect(hottest.x).toBeGreaterThan(85);
  });

  it('discards coordinates outside the pitch', () => {
    const result = buildHeatmap([
      { x: 50, y: 34 },
      { x: 400, y: 34 },
      { x: Number.NaN, y: 10 },
    ]);
    expect(result.sampleSize).toBe(1);
  });

  it('handles an empty event list', () => {
    const result = buildHeatmap([]);
    expect(result.sampleSize).toBe(0);
    expect(result.maxValue).toBe(0);
  });
});

describe('applyHeatmapFilters', () => {
  const events = [
    { minute: 10, period: 1, type: 'PASS', teamId: 'a', inPossession: true },
    { minute: 60, period: 2, type: 'PASS', teamId: 'a', inPossession: false },
    { minute: 70, period: 2, type: 'SHOT', teamId: 'b', inPossession: true },
  ];

  it('filters by half, minute range, team, type and possession', () => {
    expect(applyHeatmapFilters(events, { half: 1 })).toHaveLength(1);
    expect(applyHeatmapFilters(events, { minuteFrom: 50 })).toHaveLength(2);
    expect(applyHeatmapFilters(events, { teamId: 'b' })).toHaveLength(1);
    expect(applyHeatmapFilters(events, { eventTypes: ['SHOT'] })).toHaveLength(1);
    expect(applyHeatmapFilters(events, { possession: 'OUT' })).toHaveLength(1);
  });
});

/** Zone engine (§36). */
describe('zones', () => {
  it('maps coordinates onto thirds and lanes', () => {
    expect(zoneFor({ x: 10, y: 5 }).key).toBe('Defensive/Left');
    expect(zoneFor({ x: 52.5, y: 34 }).key).toBe('Middle/Centre');
    expect(zoneFor({ x: 100, y: 64 }).key).toBe('Attacking/Right');
  });

  it('offers a 5x4 tactical grid as well', () => {
    expect(zoneFor({ x: 5, y: 5 }, 'GRID_5X4').key).toBe('C1R1');
    expect(allZones('GRID_5X4')).toHaveLength(20);
    expect(allZones('THIRDS_LANES')).toHaveLength(15);
  });

  it('aggregates events per zone by kind', () => {
    const zones = aggregateZones([
      { x: 100, y: 34, kind: 'shots' },
      { x: 100, y: 34, kind: 'shots' },
      { x: 10, y: 34, kind: 'defensiveActions' },
      { x: null, y: 34, kind: 'passes' },
    ]);

    const attacking = zones.find((zone) => zone.zoneKey === 'Attacking/Centre');
    expect(attacking?.shots).toBe(2);
    expect(zones.find((zone) => zone.zoneKey === 'Defensive/Centre')?.defensiveActions).toBe(1);
    // The event without coordinates is ignored rather than placed arbitrarily.
    expect(zones.reduce((sum, zone) => sum + zone.passes, 0)).toBe(0);
  });
});

/** Tracking engine (§37). */
describe('tracking', () => {
  const frame = (timestampMs: number, offset: number) => ({
    timestampMs,
    period: 1,
    ballInPlay: true,
    possessionTeamId: 'home',
    players: [
      { playerId: 'p1', teamId: 'home', x: 20 + offset, y: 20 },
      { playerId: 'p2', teamId: 'home', x: 30 + offset, y: 34 },
      { playerId: 'p3', teamId: 'home', x: 40 + offset, y: 48 },
      { playerId: 'p4', teamId: 'away', x: 80, y: 34 },
    ],
  });

  it('computes team shape per phase', () => {
    const shapes = aggregateTeamShape([frame(0, 0), frame(100, 1), frame(200, 2)], 'home');
    const all = shapes.find((shape) => shape.phase === 'ALL')!;

    expect(all.frames).toBe(3);
    expect(all.teamWidthM).toBe(28);
    expect(all.teamDepthM).toBe(20);
    expect(all.lineDistanceM).toBe(20);
    expect(all.compactness).toBeGreaterThan(0);
    expect(shapes.some((shape) => shape.phase === 'IN_POSSESSION')).toBe(true);
  });

  it('excludes frames with the ball out of play', () => {
    const shapes = aggregateTeamShape(
      [{ ...frame(0, 0), ballInPlay: false }, frame(100, 1)],
      'home',
    );
    expect(shapes.find((shape) => shape.phase === 'ALL')?.frames).toBe(1);
  });

  it('integrates distance and counts sprints', () => {
    const frames = Array.from({ length: 11 }, (_, index) => ({
      timestampMs: index * 100,
      period: 1,
      ballInPlay: true,
      possessionTeamId: null,
      players: [{ playerId: 'p1', teamId: 'home', x: index * 0.8, y: 34, speedMs: 8 }],
    }));

    const [player] = aggregatePlayers(frames, 10);
    expect(player?.distanceM).toBeCloseTo(8, 1);
    expect(player?.sprintCount).toBe(1);
    expect(player?.maxSpeedMs).toBe(8);
  });

  it('discards implausible tracking jumps rather than inflating distance', () => {
    const frames = [
      {
        timestampMs: 0,
        period: 1,
        ballInPlay: true,
        possessionTeamId: null,
        players: [{ playerId: 'p1', teamId: 'home', x: 0, y: 34 }],
      },
      {
        timestampMs: 100,
        period: 1,
        ballInPlay: true,
        possessionTeamId: null,
        players: [{ playerId: 'p1', teamId: 'home', x: 90, y: 34 }],
      },
    ];

    expect(aggregatePlayers(frames, 10)[0]?.distanceM).toBe(0);
  });

  it('measures the area a shape covers', () => {
    expect(
      convexHullArea([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ]),
    ).toBe(100);
    expect(convexHullArea([{ x: 0, y: 0 }])).toBe(0);
  });
});
