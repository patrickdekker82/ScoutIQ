import type { PrismaClient } from '@prisma/client';
import { aggregatePlayerStats, positionGroup, scoutScore, type PlayerAggregate } from '../domain/analytics.js';
import { logger } from '../lib/logger.js';
import { getPrisma } from '../lib/prisma.js';

/**
 * Recomputes PlayerMetric rows for a season.
 *
 * Reads through ANALYTICS_DATABASE_URL when configured (falling back to
 * DATABASE_URL), so analytics can be pointed at a read replica once the
 * deployment is split across machines.
 */
export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient = getPrisma()) {}

  async recomputeSeason(season: string): Promise<number> {
    const players = await this.prisma.player.findMany({
      select: {
        id: true,
        position: true,
        matchStats: {
          where: { match: { competition: { season } } },
          select: {
            minutesPlayed: true,
            goals: true,
            assists: true,
            shots: true,
            xg: true,
            xa: true,
            passes: true,
            passesCompleted: true,
            progressivePasses: true,
            duelsWon: true,
            duelsTotal: true,
          },
        },
      },
    });

    const aggregates = new Map<string, { position: string; aggregate: PlayerAggregate }>();
    for (const player of players) {
      if (player.matchStats.length === 0) continue;
      aggregates.set(player.id, {
        position: player.position,
        aggregate: aggregatePlayerStats(player.matchStats),
      });
    }

    // Comparison populations are built per position group so a centre-back is
    // never scored against a striker's shot volume.
    const populations = new Map<string, PlayerAggregate[]>();
    for (const { position, aggregate } of aggregates.values()) {
      const group = positionGroup(position);
      const bucket = populations.get(group) ?? [];
      bucket.push(aggregate);
      populations.set(group, bucket);
    }

    let written = 0;
    for (const [playerId, { position, aggregate }] of aggregates) {
      const population = populations.get(positionGroup(position)) ?? [];
      const score = scoutScore({ position, aggregate, population });

      const data = {
        season,
        minutesPlayed: aggregate.minutesPlayed,
        matches: aggregate.matches,
        goalsPer90: aggregate.goalsPer90,
        assistsPer90: aggregate.assistsPer90,
        xgPer90: aggregate.xgPer90,
        xaPer90: aggregate.xaPer90,
        passAccuracy: aggregate.passAccuracy,
        progPassPer90: aggregate.progPassPer90,
        duelWinRate: aggregate.duelWinRate,
        scoutScore: score,
        computedAt: new Date(),
      };

      await this.prisma.playerMetric.upsert({
        where: { playerId_season: { playerId, season } },
        update: data,
        create: { playerId, ...data },
      });
      written += 1;
    }

    logger.info({ season, players: written }, 'analytics recomputed');
    return written;
  }

  /** Seasons that currently have match data, newest first. */
  async knownSeasons(): Promise<string[]> {
    const rows = await this.prisma.competition.findMany({
      select: { season: true },
      distinct: ['season'],
      orderBy: { season: 'desc' },
    });
    return rows.map((row) => row.season);
  }
}
