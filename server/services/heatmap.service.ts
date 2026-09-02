import { EventType, HeatmapType, type PrismaClient } from '@prisma/client';
import { buildHeatmap, type HeatmapAlgorithmKey, type HeatmapResult } from '@/analytics/heatmap';
import { aggregateZones, type ZoneScheme } from '@/analytics/zones';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma as defaultPrisma } from '@/db/client';

/**
 * Heatmap service (§34, §35, §36).
 *
 * Builds heatmaps on demand from canonical events. Only the grid is sent to
 * the browser - never the underlying events (§59).
 */

export interface HeatmapQuery {
  playerId?: string;
  teamId?: string;
  matchId?: string;
  competitionSeasonId?: string;
  type: HeatmapType;
  algorithm?: HeatmapAlgorithmKey;
  cols?: number;
  rows?: number;
  bandwidth?: number;
  half?: 1 | 2;
  minuteFrom?: number;
  minuteTo?: number;
  possession?: 'IN' | 'OUT';
  persist?: boolean;
}

/** Which event types feed which heatmap, and which end of the event to plot. */
const SOURCES: Record<HeatmapType, { types: EventType[]; useEnd?: boolean }> = {
  TOUCH: {
    types: [
      EventType.PASS,
      EventType.CARRY,
      EventType.DRIBBLE,
      EventType.SHOT,
      EventType.TOUCH,
      EventType.CLEARANCE,
    ],
  },
  PASS_ORIGIN: { types: [EventType.PASS] },
  PASS_DESTINATION: { types: [EventType.PASS], useEnd: true },
  CARRY: { types: [EventType.CARRY] },
  SHOT: { types: [EventType.SHOT] },
  DEFENSIVE_ACTION: {
    types: [
      EventType.TACKLE,
      EventType.INTERCEPTION,
      EventType.BLOCK,
      EventType.CLEARANCE,
      EventType.RECOVERY,
    ],
  },
  PRESSURE: { types: [EventType.PRESSURE] },
  COMBINED_ACTIVITY: {
    types: [
      EventType.PASS,
      EventType.CARRY,
      EventType.DRIBBLE,
      EventType.SHOT,
      EventType.TACKLE,
      EventType.INTERCEPTION,
      EventType.PRESSURE,
      EventType.RECOVERY,
      EventType.CLEARANCE,
    ],
  },
};

export class HeatmapService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async build(query: HeatmapQuery): Promise<HeatmapResult & { filters: object }> {
    const source = SOURCES[query.type];

    const events = await this.prisma.event.findMany({
      where: {
        type: { in: source.types },
        ...(query.playerId ? { playerId: query.playerId } : {}),
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(query.matchId ? { matchId: query.matchId } : {}),
        ...(query.competitionSeasonId
          ? { match: { competitionSeasonId: query.competitionSeasonId } }
          : {}),
        ...(query.minuteFrom !== undefined || query.minuteTo !== undefined
          ? {
              minute: {
                ...(query.minuteFrom !== undefined ? { gte: query.minuteFrom } : {}),
                ...(query.minuteTo !== undefined ? { lte: query.minuteTo } : {}),
              },
            }
          : {}),
        ...(query.half ? { period: { period: query.half } } : {}),
        ...(query.possession === 'IN'
          ? { possessionTeamId: { not: null } }
          : query.possession === 'OUT'
            ? { possessionTeamId: null }
            : {}),
        x: { not: null },
        y: { not: null },
      },
      select: { x: true, y: true, endX: true, endY: true, shot: { select: { xg: true } } },
      take: 50_000,
    });

    const points = events
      .map((event) => {
        const x = source.useEnd ? event.endX : event.x;
        const y = source.useEnd ? event.endY : event.y;
        if (x == null || y == null) return null;
        // Shot maps weight by xG so danger, not volume, drives the surface.
        const weight = query.type === HeatmapType.SHOT ? Math.max(0.05, event.shot?.xg ?? 0.05) : 1;
        return { x, y, weight };
      })
      .filter((point): point is { x: number; y: number; weight: number } => point !== null);

    const filters = {
      half: query.half ?? null,
      minuteFrom: query.minuteFrom ?? null,
      minuteTo: query.minuteTo ?? null,
      possession: query.possession ?? null,
      type: query.type,
    };

    const result = buildHeatmap(points, {
      algorithm: query.algorithm ?? 'GRID_DENSITY',
      ...(query.cols ? { cols: query.cols } : {}),
      ...(query.rows ? { rows: query.rows } : {}),
      ...(query.bandwidth ? { bandwidth: query.bandwidth } : {}),
    });

    if (query.persist) await this.persist(query, result, filters);

    return { ...result, filters };
  }

  private async persist(
    query: HeatmapQuery,
    result: HeatmapResult,
    filters: object,
  ): Promise<string> {
    const heatmap = await this.prisma.heatmap.create({
      data: {
        subjectType: query.playerId ? 'PLAYER' : 'TEAM',
        playerId: query.playerId ?? null,
        teamId: query.teamId ?? null,
        matchId: query.matchId ?? null,
        competitionSeasonId: query.competitionSeasonId ?? null,
        type: query.type,
        algorithm: result.algorithm,
        gridCols: result.cols,
        gridRows: result.rows,
        bandwidth: result.bandwidth,
        filters: filters as object,
        totalWeight: result.totalWeight,
        maxValue: result.maxValue,
        sampleSize: result.sampleSize,
        analyticsVersion: ANALYTICS_VERSION,
      },
    });

    await this.prisma.heatmapPoint.createMany({
      data: result.cells
        .filter((cell) => cell.value > 0)
        .map((cell) => ({
          heatmapId: heatmap.id,
          col: cell.col,
          row: cell.row,
          x: cell.x,
          y: cell.y,
          value: cell.value,
          count: cell.count,
        })),
    });

    return heatmap.id;
  }

  /** Zone activity for a player or team (§36). */
  async zoneActivity(
    subject: { playerId?: string; teamId?: string; matchId?: string; competitionSeasonId?: string },
    scheme: ZoneScheme = 'THIRDS_LANES',
    persist = false,
  ) {
    const events = await this.prisma.event.findMany({
      where: {
        ...(subject.playerId ? { playerId: subject.playerId } : {}),
        ...(subject.teamId ? { teamId: subject.teamId } : {}),
        ...(subject.matchId ? { matchId: subject.matchId } : {}),
        ...(subject.competitionSeasonId
          ? { match: { competitionSeasonId: subject.competitionSeasonId } }
          : {}),
        x: { not: null },
        y: { not: null },
      },
      select: { x: true, y: true, type: true, durationSec: true },
      take: 50_000,
    });

    const zones = aggregateZones(
      events.map((event) => ({
        x: event.x,
        y: event.y,
        kind: kindOf(event.type),
        ...(event.durationSec ? { durationSec: event.durationSec } : {}),
      })),
      scheme,
    );

    if (persist) {
      for (const zone of zones) {
        await this.prisma.heatmapZoneStatistic.create({
          data: {
            playerId: subject.playerId ?? null,
            teamId: subject.teamId ?? null,
            matchId: subject.matchId ?? null,
            zoneScheme: zone.scheme,
            zoneKey: zone.zoneKey,
            zoneRow: zone.zoneRow,
            zoneCol: zone.zoneCol,
            touches: zone.touches,
            passes: zone.passes,
            carries: zone.carries,
            shots: zone.shots,
            defensiveActions: zone.defensiveActions,
            pressures: zone.pressures,
            possessionTimeSec: zone.possessionTimeSec,
            analyticsVersion: ANALYTICS_VERSION,
          },
        });
      }
    }

    return zones;
  }
}

function kindOf(type: EventType): 'touches' | 'passes' | 'carries' | 'shots' | 'defensiveActions' | 'pressures' {
  switch (type) {
    case EventType.PASS:
      return 'passes';
    case EventType.CARRY:
    case EventType.DRIBBLE:
      return 'carries';
    case EventType.SHOT:
      return 'shots';
    case EventType.PRESSURE:
      return 'pressures';
    case EventType.TACKLE:
    case EventType.INTERCEPTION:
    case EventType.BLOCK:
    case EventType.CLEARANCE:
    case EventType.RECOVERY:
      return 'defensiveActions';
    default:
      return 'touches';
  }
}
