import { Prisma, type PrismaClient } from '@prisma/client';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma as defaultPrisma } from '@/db/client';

/**
 * Player search (§45) and global search (§46).
 *
 * Filters map onto indexed columns and the season-metric table; the metric
 * filters accept operators so a scout can ask a real question ("progressive
 * passes p90 above 6, aged under 23, at least 900 minutes") rather than sort a
 * table by one column at a time.
 */

export type Operator = 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'between' | 'percentile';

export interface MetricFilter {
  metricKey: string;
  operator: Operator;
  value: number;
  /** Upper bound for `between`. */
  value2?: number;
}

export interface PlayerSearchParams {
  name?: string;
  minAge?: number;
  maxAge?: number;
  nationality?: string;
  positionGroups?: string[];
  preferredFoot?: string;
  minHeightCm?: number;
  maxHeightCm?: number;
  teamId?: string;
  competitionSeasonId?: string;
  minMinutes?: number;
  metrics?: MetricFilter[];
  includeDemo?: boolean;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  take?: number;
  skip?: number;
}

export interface PlayerSearchRow {
  playerId: string;
  playerName: string;
  age: number | null;
  nationality: string | null;
  positionGroup: string;
  position: string;
  teamId: string | null;
  teamName: string | null;
  competitionSeasonId: string | null;
  seasonName: string | null;
  minutes: number;
  matches: number;
  confidence: string | null;
  isDemo: boolean;
  metrics: Record<string, number>;
}

/** Metric columns a filter or sort may reference (guards against injection). */
export const SEARCHABLE_METRICS = [
  'minutes',
  'matches',
  'goalsP90',
  'assistsP90',
  'xgP90',
  'npxgP90',
  'xaP90',
  'shotsP90',
  'shotsOnTargetP90',
  'passesP90',
  'passAccuracy',
  'progressivePassesP90',
  'progressiveCarriesP90',
  'progressiveActionsP90',
  'passesFinalThirdP90',
  'passesIntoBoxP90',
  'keyPassesP90',
  'chancesCreatedP90',
  'crossesP90',
  'dribblesP90',
  'dribbleSuccessRate',
  'touchesP90',
  'touchesFinalThirdP90',
  'touchesBoxP90',
  'pressuresP90',
  'counterpressuresP90',
  'tacklesP90',
  'interceptionsP90',
  'recoveriesP90',
  'blocksP90',
  'clearancesP90',
  'aerialDuelsP90',
  'aerialDuelWinRate',
  'defensiveDuelsP90',
  'defensiveDuelWinRate',
] as const;

export type SearchableMetric = (typeof SEARCHABLE_METRICS)[number];

const isSearchable = (key: string): key is SearchableMetric =>
  (SEARCHABLE_METRICS as readonly string[]).includes(key);

export class SearchService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async searchPlayers(params: PlayerSearchParams): Promise<{
    total: number;
    rows: PlayerSearchRow[];
  }> {
    const take = Math.min(params.take ?? 50, 200);
    const skip = params.skip ?? 0;

    const metricWhere: Prisma.PlayerSeasonMetricWhereInput = {
      analyticsVersion: ANALYTICS_VERSION,
      ...(params.competitionSeasonId ? { competitionSeasonId: params.competitionSeasonId } : {}),
      ...(params.minMinutes ? { minutes: { gte: params.minMinutes } } : {}),
      ...(params.positionGroups?.length ? { positionGroup: { in: params.positionGroups } } : {}),
      ...(params.teamId ? { teamId: params.teamId } : {}),
    };

    // Percentile filters need the population, so they are applied after the
    // query; everything else is pushed into SQL.
    const directFilters: Record<string, Prisma.FloatFilter | Prisma.IntFilter> = {};
    const percentileFilters: MetricFilter[] = [];

    for (const filter of params.metrics ?? []) {
      if (!isSearchable(filter.metricKey)) continue;

      if (filter.operator === 'percentile') {
        percentileFilters.push(filter);
        continue;
      }

      const condition: Record<string, number> =
        filter.operator === 'between'
          ? { gte: filter.value, lte: filter.value2 ?? filter.value }
          : filter.operator === 'eq'
            ? { equals: filter.value }
            : { [filter.operator]: filter.value };

      directFilters[filter.metricKey] = condition as Prisma.FloatFilter;
    }

    Object.assign(metricWhere, directFilters);

    const now = new Date();
    const playerWhere: Prisma.PlayerWhereInput = {
      ...(params.includeDemo === false ? { isDemo: false } : {}),
      ...(params.name
        ? {
            OR: [
              { fullName: { contains: params.name, mode: 'insensitive' } },
              { knownAs: { contains: params.name, mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: params.name, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(params.preferredFoot
        ? { preferredFoot: params.preferredFoot as 'LEFT' | 'RIGHT' | 'BOTH' | 'UNKNOWN' }
        : {}),
      ...(params.nationality
        ? { country: { name: { equals: params.nationality, mode: 'insensitive' } } }
        : {}),
      ...(params.minHeightCm || params.maxHeightCm
        ? {
            heightCm: {
              ...(params.minHeightCm ? { gte: params.minHeightCm } : {}),
              ...(params.maxHeightCm ? { lte: params.maxHeightCm } : {}),
            },
          }
        : {}),
      // Age filters translate to a date-of-birth window.
      ...(params.minAge || params.maxAge
        ? {
            dateOfBirth: {
              ...(params.maxAge
                ? { gte: new Date(now.getFullYear() - params.maxAge - 1, now.getMonth(), now.getDate()) }
                : {}),
              ...(params.minAge
                ? { lte: new Date(now.getFullYear() - params.minAge, now.getMonth(), now.getDate()) }
                : {}),
            },
          }
        : {}),
    };

    const sortBy = params.sortBy && isSearchable(params.sortBy) ? params.sortBy : 'minutes';
    const sortDirection = params.sortDirection ?? 'desc';

    const where: Prisma.PlayerSeasonMetricWhereInput = {
      ...metricWhere,
      player: playerWhere,
    };

    const [total, rows] = await Promise.all([
      this.prisma.playerSeasonMetric.count({ where }),
      this.prisma.playerSeasonMetric.findMany({
        where,
        include: {
          player: {
            select: {
              id: true,
              fullName: true,
              dateOfBirth: true,
              primaryPosition: true,
              positionGroup: true,
              isDemo: true,
              country: { select: { name: true } },
            },
          },
          season: { select: { id: true, seasonName: true } },
        },
        orderBy: { [sortBy]: sortDirection },
        take: percentileFilters.length > 0 ? 500 : take,
        skip: percentileFilters.length > 0 ? 0 : skip,
      }),
    ]);

    let mapped = rows.map((row) => this.toRow(row));

    if (percentileFilters.length > 0) {
      mapped = await this.applyPercentileFilters(mapped, percentileFilters, params);
      mapped = mapped.slice(skip, skip + take);
    }

    return { total: percentileFilters.length > 0 ? mapped.length : total, rows: mapped };
  }

  private toRow(row: {
    playerId: string;
    teamId: string | null;
    positionGroup: string;
    minutes: number;
    matches: number;
    confidence: string;
    competitionSeasonId: string;
    player: {
      fullName: string;
      dateOfBirth: Date | null;
      primaryPosition: string;
      isDemo: boolean;
      country: { name: string } | null;
    };
    season: { seasonName: string } | null;
  }): PlayerSearchRow {
    const metrics: Record<string, number> = {};
    for (const key of SEARCHABLE_METRICS) {
      const value = (row as unknown as Record<string, unknown>)[key];
      if (typeof value === 'number') metrics[key] = value;
    }

    return {
      playerId: row.playerId,
      playerName: row.player.fullName,
      age: ageOf(row.player.dateOfBirth),
      nationality: row.player.country?.name ?? null,
      positionGroup: row.positionGroup,
      position: row.player.primaryPosition,
      teamId: row.teamId,
      teamName: null,
      competitionSeasonId: row.competitionSeasonId,
      seasonName: row.season?.seasonName ?? null,
      minutes: row.minutes,
      matches: row.matches,
      confidence: row.confidence,
      isDemo: row.player.isDemo,
      metrics,
    };
  }

  /** Percentile filters compare against the season+position population. */
  private async applyPercentileFilters(
    rows: PlayerSearchRow[],
    filters: MetricFilter[],
    params: PlayerSearchParams,
  ): Promise<PlayerSearchRow[]> {
    const percentiles = await this.prisma.$queryRaw<
      { player_id: string; metric_key: string; percentile: number }[]
    >`
      SELECT player_id, metric_key, percentile
      FROM vw_player_percentiles
      WHERE analytics_version = ${ANALYTICS_VERSION}
        AND (${params.competitionSeasonId ?? null}::text IS NULL
             OR competition_season_id = ${params.competitionSeasonId ?? null})
    `;

    const index = new Map<string, number>();
    for (const entry of percentiles) {
      index.set(`${entry.player_id}:${camelOf(entry.metric_key)}`, Number(entry.percentile));
    }

    return rows.filter((row) =>
      filters.every((filter) => {
        const percentile = index.get(`${row.playerId}:${filter.metricKey}`);
        if (percentile === undefined) return false;
        return percentile >= filter.value;
      }),
    );
  }

  /** Global fuzzy search across the entities of §46. */
  async globalSearch(query: string, limit = 5) {
    const term = query.trim();
    if (term.length < 2) {
      return { players: [], teams: [], matches: [], competitions: [], shortlists: [], reports: [] };
    }

    const contains = { contains: term, mode: 'insensitive' as const };

    const [players, teams, matches, competitions, shortlists, reports] = await Promise.all([
      this.prisma.player.findMany({
        where: { OR: [{ fullName: contains }, { knownAs: contains }] },
        select: { id: true, fullName: true, primaryPosition: true, isDemo: true },
        take: limit,
      }),
      this.prisma.team.findMany({
        where: { OR: [{ name: contains }, { aliases: { some: { alias: contains } } }] },
        select: { id: true, name: true, isDemo: true },
        take: limit,
      }),
      this.prisma.match.findMany({
        where: { OR: [{ homeTeam: { name: contains } }, { awayTeam: { name: contains } }] },
        select: {
          id: true,
          kickoffAt: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
        orderBy: { kickoffAt: 'desc' },
        take: limit,
      }),
      this.prisma.competition.findMany({
        where: { name: contains },
        select: { id: true, name: true },
        take: limit,
      }),
      this.prisma.shortlist.findMany({
        where: { name: contains },
        select: { id: true, name: true },
        take: limit,
      }),
      this.prisma.report.findMany({
        where: { title: contains },
        select: { id: true, title: true, type: true },
        take: limit,
      }),
    ]);

    return { players, teams, matches, competitions, shortlists, reports };
  }
}

const ageOf = (dateOfBirth: Date | null): number | null => {
  if (!dateOfBirth) return null;
  const diff = Date.now() - dateOfBirth.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

/** vw_player_percentiles exposes snake_case; filters speak camelCase. */
const camelOf = (value: string): string =>
  value.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
