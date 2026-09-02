import type { PrismaClient } from '@prisma/client';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma as defaultPrisma } from '@/db/client';
import { SEARCHABLE_METRICS } from '@/server/services/search.service';

/**
 * Player and club comparison (§43, §44).
 *
 * Comparison is only honest when everyone is measured against the same
 * population, so each player carries the competition season and position group
 * their percentiles came from. Where two players are ranked in different
 * populations the page says so rather than pretending the numbers line up.
 */

export const COMPARISON_METRICS = SEARCHABLE_METRICS.filter(
  (key) => key !== 'minutes' && key !== 'matches',
);

export interface ComparedPlayer {
  id: string;
  fullName: string;
  isDemo: boolean;
  primaryPosition: string | null;
  positionGroup: string | null;
  age: number | null;
  nationality: string | null;
  preferredFoot: string | null;
  heightCm: number | null;
  club: string | null;

  season: {
    competitionSeasonId: string;
    competitionName: string;
    seasonName: string;
    positionGroup: string;
    minutes: number;
    matches: number;
    confidence: string;
  } | null;

  metrics: Record<string, number>;
  percentiles: Record<string, { percentile: number; populationSize: number }>;
  dna: Record<string, number>;
  roles: { name: string; score: number }[];
  fits: { teamId: string; teamName: string; fitScore: number }[];
  strengths: { metricKey: string; percentile: number }[];
  weaknesses: { metricKey: string; percentile: number }[];
}

export interface PlayerComparison {
  analyticsVersion: string;
  players: ComparedPlayer[];
  /** Populations differ when players are ranked in different season/position pools. */
  sharedPopulation: boolean;
  /** DNA categories present for at least one player, in a stable order. */
  dnaCategories: string[];
  metricKeys: string[];
}

/**
 * The percentile views expose snake_case keys (`xg_p90`), while the metric
 * columns are camelCase (`xgP90`). Percentiles are re-keyed to the column name
 * so a metric row and its rank are the same thing to every caller.
 */
const toCamel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase());

type PercentileRow = {
  player_id: string;
  metric_key: string;
  percentile: number;
  population_size: number;
};

export class ComparisonService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /** Compare 2-5 players (§43). */
  async comparePlayers(ids: readonly string[]): Promise<PlayerComparison> {
    const unique = [...new Set(ids)];
    if (unique.length < 2) throw new Error('Comparison needs at least two players.');
    if (unique.length > 5) throw new Error('Comparison is limited to five players.');

    const players = await this.prisma.player.findMany({
      where: { id: { in: unique } },
      include: {
        country: { select: { name: true } },
        memberships: {
          where: { endDate: null },
          include: { team: { select: { name: true } } },
          take: 1,
        },
      },
    });

    // Preserve the caller's order; a comparison table reads left to right.
    const byId = new Map(players.map((player) => [player.id, player]));
    const ordered = unique.map((id) => byId.get(id)).filter((player) => player !== undefined);

    const compared = await Promise.all(ordered.map((player) => this.buildPlayer(player)));

    const populations = new Set(
      compared.map((player) =>
        player.season ? `${player.season.competitionSeasonId}|${player.season.positionGroup}` : '-',
      ),
    );

    const dnaCategories: string[] = [];
    for (const player of compared) {
      for (const category of Object.keys(player.dna)) {
        if (!dnaCategories.includes(category)) dnaCategories.push(category);
      }
    }

    // Only show metric rows where at least one player has a non-zero value:
    // a table of forty zeroes teaches nothing (§92).
    const metricKeys = COMPARISON_METRICS.filter((key) =>
      compared.some((player) => (player.metrics[key] ?? 0) !== 0),
    );

    return {
      analyticsVersion: ANALYTICS_VERSION,
      players: compared,
      sharedPopulation: populations.size === 1 && !populations.has('-'),
      dnaCategories,
      metricKeys,
    };
  }

  private async buildPlayer(
    player: Awaited<ReturnType<ComparisonService['loadPlayers']>>[number],
  ): Promise<ComparedPlayer> {
    const seasonMetric = await this.prisma.playerSeasonMetric.findFirst({
      where: { playerId: player.id, analyticsVersion: ANALYTICS_VERSION },
      include: {
        season: { include: { competition: { select: { name: true } } } },
        team: { select: { name: true } },
      },
      orderBy: { minutes: 'desc' },
    });

    const [percentileRows, style, roles, fits] = await Promise.all([
      seasonMetric
        ? this.prisma.$queryRaw<PercentileRow[]>`
            SELECT player_id, metric_key, percentile, population_size
            FROM vw_player_percentiles
            WHERE player_id = ${player.id}
              AND competition_season_id = ${seasonMetric.competitionSeasonId}
              AND analytics_version = ${ANALYTICS_VERSION}
          `
        : Promise.resolve([] as PercentileRow[]),
      seasonMetric
        ? this.prisma.playerStyleProfile.findFirst({
            where: {
              playerId: player.id,
              competitionSeasonId: seasonMetric.competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
          })
        : Promise.resolve(null),
      this.prisma.playerRoleScore.findMany({
        where: { playerId: player.id, analyticsVersion: ANALYTICS_VERSION },
        include: { role: { select: { name: true } } },
        orderBy: { score: 'desc' },
        take: 5,
      }),
      this.prisma.playerFitScore.findMany({
        where: { playerId: player.id, analyticsVersion: ANALYTICS_VERSION },
        include: { team: { select: { id: true, name: true } } },
        orderBy: { fitScore: 'desc' },
        take: 5,
      }),
    ]);

    const metrics: Record<string, number> = {};
    if (seasonMetric) {
      const row = seasonMetric as unknown as Record<string, unknown>;
      for (const key of COMPARISON_METRICS) {
        const value = row[key];
        if (typeof value === 'number') metrics[key] = value;
      }
    }

    const percentiles: Record<string, { percentile: number; populationSize: number }> = {};
    for (const row of percentileRows) {
      percentiles[toCamel(row.metric_key)] = {
        percentile: Number(row.percentile),
        populationSize: Number(row.population_size),
      };
    }

    const ranked = Object.entries(percentiles)
      .map(([metricKey, entry]) => ({ metricKey, percentile: entry.percentile }))
      .sort((a, b) => b.percentile - a.percentile);

    const age = player.dateOfBirth
      ? Math.floor((Date.now() - player.dateOfBirth.getTime()) / (365.25 * 864e5))
      : null;

    return {
      id: player.id,
      fullName: player.fullName,
      isDemo: player.isDemo,
      primaryPosition: player.primaryPosition,
      positionGroup: player.positionGroup,
      age,
      nationality: player.country?.name ?? null,
      preferredFoot: player.preferredFoot,
      heightCm: player.heightCm,
      club: seasonMetric?.team?.name ?? player.memberships[0]?.team.name ?? null,
      season: seasonMetric
        ? {
            competitionSeasonId: seasonMetric.competitionSeasonId,
            competitionName: seasonMetric.season.competition.name,
            seasonName: seasonMetric.season.seasonName,
            positionGroup: seasonMetric.positionGroup,
            minutes: seasonMetric.minutes,
            matches: seasonMetric.matches,
            confidence: seasonMetric.confidence,
          }
        : null,
      metrics,
      percentiles,
      dna: (style?.dna as Record<string, number> | undefined) ?? {},
      roles: roles.map((entry) => ({ name: entry.role.name, score: entry.score })),
      fits: fits.map((entry) => ({
        teamId: entry.team.id,
        teamName: entry.team.name,
        fitScore: entry.fitScore,
      })),
      // Strengths and weaknesses are percentile facts, not adjectives (§85).
      strengths: ranked.filter((entry) => entry.percentile >= 70).slice(0, 5),
      weaknesses: ranked
        .filter((entry) => entry.percentile <= 30)
        .slice(-5)
        .reverse(),
    };
  }

  /** Typing helper: gives `buildPlayer` the exact shape `findMany` returns. */
  private loadPlayers() {
    return this.prisma.player.findMany({
      include: {
        country: { select: { name: true } },
        memberships: {
          where: { endDate: null },
          include: { team: { select: { name: true } } },
          take: 1,
        },
      },
    });
  }
}

export const comparisonService = new ComparisonService();
