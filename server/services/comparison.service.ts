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


// ---------------------------------------------------------------------------
// Club comparison (§44)
// ---------------------------------------------------------------------------

/**
 * Season metrics shown side by side, with how to read each one.
 *
 * `higherIsBetter` is deliberately explicit and sometimes null: more possession
 * is not better football, and a lower PPDA means a more aggressive press. The
 * UI leans on this rather than assuming bigger is greener (§85).
 */
export const CLUB_METRICS = [
  { key: 'possession', label: 'Possession', unit: 'percent', higherIsBetter: null },
  { key: 'xgP90', label: 'xG per 90', unit: 'rate', higherIsBetter: true },
  { key: 'xgAgainstP90', label: 'xG against per 90', unit: 'rate', higherIsBetter: false },
  { key: 'shotsP90', label: 'Shots per 90', unit: 'rate', higherIsBetter: true },
  { key: 'progressionP90', label: 'Progression per 90', unit: 'rate', higherIsBetter: true },
  { key: 'finalThirdEntriesP90', label: 'Final third entries per 90', unit: 'rate', higherIsBetter: true },
  { key: 'boxEntriesP90', label: 'Box entries per 90', unit: 'rate', higherIsBetter: true },
  { key: 'directness', label: 'Directness', unit: 'rate', higherIsBetter: null },
  { key: 'fieldTilt', label: 'Field tilt', unit: 'percent', higherIsBetter: true },
  { key: 'passesP90', label: 'Passes per 90', unit: 'rate', higherIsBetter: null },
  { key: 'passAccuracy', label: 'Pass accuracy', unit: 'percent', higherIsBetter: true },
  { key: 'pressuresP90', label: 'Pressures per 90', unit: 'rate', higherIsBetter: null },
  { key: 'recoveriesP90', label: 'Recoveries per 90', unit: 'rate', higherIsBetter: true },
  { key: 'ppda', label: 'PPDA', unit: 'rate', higherIsBetter: false },
] as const;

export type ClubMetricKey = (typeof CLUB_METRICS)[number]['key'];

/** Per-match series shown as trend lines (§44). */
export const CLUB_TREND_METRICS = [
  { key: 'xg', label: 'xG' },
  { key: 'possession', label: 'Possession' },
  { key: 'crosses', label: 'Crosses' },
  { key: 'directness', label: 'Directness' },
] as const;

export interface ComparedClub {
  id: string;
  name: string;
  isDemo: boolean;
  season: {
    competitionSeasonId: string;
    competitionName: string;
    seasonName: string;
    matches: number;
    confidence: string;
  } | null;
  metrics: Record<string, number | null>;
  /** Rank of each metric among the clubs in the same competition season. */
  percentiles: Record<string, number>;
  style: Record<string, number>;
  /** Defensive actions per match, summed from the per-match metrics. */
  defensiveActionsPerMatch: number | null;
  crossesPerMatch: number | null;
  trend: { matchId: string; label: string; kickoffAt: string; values: Record<string, number> }[];
}

export interface ClubComparison {
  analyticsVersion: string;
  clubs: ComparedClub[];
  sharedPopulation: boolean;
  styleDimensions: string[];
  metrics: typeof CLUB_METRICS;
  trendMetrics: typeof CLUB_TREND_METRICS;
  /** How many clubs each percentile was computed against, by season. */
  populationSizes: Record<string, number>;
}

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


  /** Compare 2-5 clubs (§44). */
  async compareTeams(ids: readonly string[]): Promise<ClubComparison> {
    const unique = [...new Set(ids)];
    if (unique.length < 2) throw new Error('Comparison needs at least two clubs.');
    if (unique.length > 5) throw new Error('Comparison is limited to five clubs.');

    const teams = await this.prisma.team.findMany({ where: { id: { in: unique } } });
    const byId = new Map(teams.map((team) => [team.id, team]));
    const ordered = unique.map((id) => byId.get(id)).filter((team) => team !== undefined);

    const seasonMetrics = await this.prisma.teamSeasonMetric.findMany({
      where: { teamId: { in: ordered.map((team) => team.id) }, analyticsVersion: ANALYTICS_VERSION },
      include: { season: { include: { competition: { select: { name: true } } } } },
      orderBy: { matches: 'desc' },
    });

    // One season per club: the one it played most of.
    const seasonByTeam = new Map<string, (typeof seasonMetrics)[number]>();
    for (const metric of seasonMetrics) {
      if (!seasonByTeam.has(metric.teamId)) seasonByTeam.set(metric.teamId, metric);
    }

    // Percentiles need the whole competition season, not just the clubs being
    // compared: "top of these three" is not a rank (§26).
    const seasonIds = [...new Set([...seasonByTeam.values()].map((m) => m.competitionSeasonId))];
    const populations = await this.prisma.teamSeasonMetric.findMany({
      where: { competitionSeasonId: { in: seasonIds }, analyticsVersion: ANALYTICS_VERSION },
    });

    const populationSizes: Record<string, number> = {};
    for (const seasonId of seasonIds) {
      populationSizes[seasonId] = populations.filter(
        (row) => row.competitionSeasonId === seasonId,
      ).length;
    }

    const clubs = await Promise.all(
      ordered.map((team) =>
        this.buildClub(team, seasonByTeam.get(team.id) ?? null, populations),
      ),
    );

    const styleDimensions: string[] = [];
    for (const club of clubs) {
      for (const dimension of Object.keys(club.style)) {
        if (!styleDimensions.includes(dimension)) styleDimensions.push(dimension);
      }
    }

    return {
      analyticsVersion: ANALYTICS_VERSION,
      clubs,
      sharedPopulation: seasonIds.length === 1 && clubs.every((club) => club.season !== null),
      styleDimensions,
      metrics: CLUB_METRICS,
      trendMetrics: CLUB_TREND_METRICS,
      populationSizes,
    };
  }

  private async buildClub(
    team: { id: string; name: string; isDemo: boolean },
    seasonMetric:
      | {
          competitionSeasonId: string;
          matches: number;
          confidence: string;
          season: { seasonName: string; competition: { name: string } };
        }
      | null,
    populations: Record<string, unknown>[],
  ): Promise<ComparedClub> {
    const [style, matchMetrics] = await Promise.all([
      seasonMetric
        ? this.prisma.teamStyleProfile.findFirst({
            where: {
              teamId: team.id,
              competitionSeasonId: seasonMetric.competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
          })
        : Promise.resolve(null),
      this.prisma.teamMatchMetric.findMany({
        where: { teamId: team.id, analyticsVersion: ANALYTICS_VERSION },
        include: {
          match: {
            select: {
              kickoffAt: true,
              homeTeam: { select: { id: true, name: true } },
              awayTeam: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { match: { kickoffAt: 'asc' } },
      }),
    ]);

    const row = seasonMetric as unknown as Record<string, unknown> | null;
    const metrics: Record<string, number | null> = {};
    for (const metric of CLUB_METRICS) {
      const value = row?.[metric.key];
      metrics[metric.key] = typeof value === 'number' ? value : null;
    }

    const percentiles: Record<string, number> = {};
    if (seasonMetric) {
      const pool = populations.filter(
        (candidate) => candidate.competitionSeasonId === seasonMetric.competitionSeasonId,
      );

      for (const metric of CLUB_METRICS) {
        const own = metrics[metric.key];
        if (own === null || own === undefined) continue;

        const values = pool
          .map((candidate) => candidate[metric.key])
          .filter((value): value is number => typeof value === 'number');
        if (values.length < 2) continue;

        const below = values.filter((value) => value < own).length;
        percentiles[metric.key] = Math.round((below / (values.length - 1)) * 1000) / 10;
      }
    }

    const average = (read: (row: (typeof matchMetrics)[number]) => number): number | null =>
      matchMetrics.length === 0
        ? null
        : Math.round((matchMetrics.reduce((sum, entry) => sum + read(entry), 0) / matchMetrics.length) * 100) /
          100;

    return {
      id: team.id,
      name: team.name,
      isDemo: team.isDemo,
      season: seasonMetric
        ? {
            competitionSeasonId: seasonMetric.competitionSeasonId,
            competitionName: seasonMetric.season.competition.name,
            seasonName: seasonMetric.season.seasonName,
            matches: seasonMetric.matches,
            confidence: seasonMetric.confidence,
          }
        : null,
      metrics,
      percentiles,
      style: (style?.style as Record<string, number> | undefined) ?? {},
      defensiveActionsPerMatch: average(
        (entry) => entry.tackles + entry.interceptions + entry.recoveries,
      ),
      crossesPerMatch: average((entry) => entry.crosses),
      trend: matchMetrics.map((entry) => ({
        matchId: entry.matchId,
        label:
          entry.match.homeTeam.id === team.id
            ? `vs ${entry.match.awayTeam.name}`
            : `at ${entry.match.homeTeam.name}`,
        kickoffAt: entry.match.kickoffAt.toISOString(),
        values: {
          xg: entry.xg,
          possession: entry.possession,
          crosses: entry.crosses,
          directness: entry.directness,
        },
      })),
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
