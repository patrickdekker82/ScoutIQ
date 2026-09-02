import { Confidence, EventType, type PrismaClient } from '@prisma/client';
import { computeDna, DNA_DEFINITION, type MetricInputs } from '@/analytics/dna';
import { computeClubFit } from '@/analytics/club-fit';
import {
  aggregateSeason,
  computePlayerMatchMetrics,
  emptyMetrics,
  seasonPer90,
  type MetricEventInput,
  type PlayerMatchMetrics,
} from '@/analytics/metrics';
import { assessQuality } from '@/analytics/quality';
import { rankRoles, type RoleRequirement } from '@/analytics/roles';
import { findSimilarPlayers } from '@/analytics/similarity';
import { computeTeamStyle, type StyleInput } from '@/analytics/team-style';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma as defaultPrisma } from '@/db/client';
import { logger } from '@/lib/logger';

/**
 * Analytics orchestration.
 *
 * Reads canonical events, writes derived rows. Every write records
 * ANALYTICS_VERSION (§53) and a data-quality assessment (§54), and every score
 * stores the breakdown that produced it (§85).
 *
 * This runs in the worker, never in a request: it is the heavy path (§59).
 */

export interface AnalyticsRunSummary {
  season: string;
  competitionSeasonId: string;
  playerMatchMetrics: number;
  playerSeasonMetrics: number;
  teamMatchMetrics: number;
  teamSeasonMetrics: number;
  dnaProfiles: number;
  roleScores: number;
  similarities: number;
  teamStyles: number;
  fitScores: number;
  durationMs: number;
}

/** The per-90 metric keys used by DNA, roles and similarity. */
const METRIC_KEYS = [
  ...new Set(Object.values(DNA_DEFINITION).flatMap((weights) => Object.keys(weights))),
  'progressivePassesP90',
  'progressiveCarriesP90',
  'passesFinalThirdP90',
  'passesIntoBoxP90',
  'keyPassesP90',
  'crossesP90',
  'tacklesP90',
  'interceptionsP90',
  'pressuresP90',
  'counterpressuresP90',
  'recoveriesP90',
  'blocksP90',
  'clearancesP90',
  'defensiveDuelsP90',
  'defensiveDuelWinRate',
  'aerialDuelsP90',
  'aerialDuelWinRate',
  'dribblesP90',
  'dribbleSuccessRate',
  'shotsP90',
  'goalsP90',
  'xgP90',
  'npxgP90',
  'xaP90',
  'chancesCreatedP90',
  'touchesP90',
  'touchesFinalThirdP90',
  'touchesBoxP90',
  'passesP90',
  'passAccuracy',
  'longPassesP90',
  'progressiveActionsP90',
  'carriesFinalThirdP90',
  'carriesIntoBoxP90',
  'xgPerShot',
  'tackleSuccessRate',
] as const;

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /** Seasons that currently hold matches, newest first. */
  async knownSeasons(): Promise<{ id: string; name: string; competition: string }[]> {
    const seasons = await this.prisma.competitionSeason.findMany({
      where: { matches: { some: {} } },
      include: { competition: { select: { name: true } } },
      orderBy: { seasonName: 'desc' },
    });

    return seasons.map((season) => ({
      id: season.id,
      name: season.seasonName,
      competition: season.competition.name,
    }));
  }

  /**
   * Recompute everything for one season, in dependency order:
   * match metrics -> season metrics -> DNA -> roles -> similarity -> team
   * style -> club fit.
   */
  async recomputeSeason(
    competitionSeasonId: string,
    onProgress: (message: string, progress: number) => void = () => undefined,
  ): Promise<AnalyticsRunSummary> {
    const started = Date.now();
    const season = await this.prisma.competitionSeason.findUniqueOrThrow({
      where: { id: competitionSeasonId },
      select: { id: true, seasonName: true },
    });

    onProgress('Computing player match metrics', 5);
    const playerMatchMetrics = await this.computePlayerMatchMetrics(competitionSeasonId);

    onProgress('Computing team match metrics', 25);
    const teamMatchMetrics = await this.computeTeamMatchMetrics(competitionSeasonId);

    onProgress('Aggregating season metrics', 40);
    const playerSeasonMetrics = await this.computePlayerSeasonMetrics(competitionSeasonId);
    const teamSeasonMetrics = await this.computeTeamSeasonMetrics(competitionSeasonId);

    onProgress('Computing player DNA', 60);
    const dnaProfiles = await this.computeDnaProfiles(competitionSeasonId);

    onProgress('Scoring roles', 70);
    const roleScores = await this.computeRoleScores(competitionSeasonId);

    onProgress('Computing similarity', 80);
    const similarities = await this.computeSimilarity(competitionSeasonId);

    onProgress('Computing team styles', 90);
    const teamStyles = await this.computeTeamStyles(competitionSeasonId);

    onProgress('Computing club fit', 95);
    const fitScores = await this.computeClubFits(competitionSeasonId);

    const summary: AnalyticsRunSummary = {
      season: season.seasonName,
      competitionSeasonId,
      playerMatchMetrics,
      playerSeasonMetrics,
      teamMatchMetrics,
      teamSeasonMetrics,
      dnaProfiles,
      roleScores,
      similarities,
      teamStyles,
      fitScores,
      durationMs: Date.now() - started,
    };

    logger.info(summary, 'analytics recomputed');
    return summary;
  }

  // -------------------------------------------------------------------
  // Match level
  // -------------------------------------------------------------------

  private async computePlayerMatchMetrics(competitionSeasonId: string): Promise<number> {
    const matches = await this.prisma.match.findMany({
      where: { competitionSeasonId },
      select: { id: true },
    });

    let written = 0;

    for (const match of matches) {
      const appearances = await this.prisma.playerMatch.findMany({
        where: { matchId: match.id },
        select: { playerId: true, teamId: true, minutesPlayed: true },
      });
      if (appearances.length === 0) continue;

      const events = await this.prisma.event.findMany({
        where: { matchId: match.id, playerId: { not: null } },
        select: {
          type: true,
          playerId: true,
          teamId: true,
          x: true,
          y: true,
          endX: true,
          endY: true,
          outcome: true,
          underPressure: true,
          durationSec: true,
          pass: true,
          shot: true,
          carry: true,
          dribble: true,
          duel: true,
          tackle: true,
          pressure: true,
          recovery: true,
        },
      });

      const byPlayer = new Map<string, MetricEventInput[]>();
      for (const event of events) {
        if (!event.playerId) continue;
        const bucket = byPlayer.get(event.playerId) ?? [];
        bucket.push(event as unknown as MetricEventInput);
        byPlayer.set(event.playerId, bucket);
      }

      for (const appearance of appearances) {
        const metrics = computePlayerMatchMetrics(
          byPlayer.get(appearance.playerId) ?? [],
          appearance.minutesPlayed,
        );

        await this.prisma.playerMatchMetric.upsert({
          where: {
            playerId_matchId_analyticsVersion: {
              playerId: appearance.playerId,
              matchId: match.id,
              analyticsVersion: ANALYTICS_VERSION,
            },
          },
          update: this.matchMetricData(metrics, appearance.teamId),
          create: {
            playerId: appearance.playerId,
            matchId: match.id,
            ...this.matchMetricData(metrics, appearance.teamId),
          },
        });
        written += 1;
      }
    }

    return written;
  }

  private matchMetricData(metrics: PlayerMatchMetrics, teamId: string | null) {
    const { available, ...numbers } = metrics;
    return {
      teamId,
      minutes: metrics.minutes,
      passes: numbers.passes,
      passesCompleted: numbers.passesCompleted,
      passAccuracy: numbers.passAccuracy,
      progressivePasses: numbers.progressivePasses,
      passesFinalThird: numbers.passesFinalThird,
      passesIntoBox: numbers.passesIntoBox,
      keyPasses: numbers.keyPasses,
      throughBalls: numbers.throughBalls,
      switches: numbers.switches,
      crosses: numbers.crosses,
      longPasses: numbers.longPasses,
      carries: numbers.carries,
      progressiveCarries: numbers.progressiveCarries,
      carriesFinalThird: numbers.carriesFinalThird,
      carriesIntoBox: numbers.carriesIntoBox,
      dribbles: numbers.dribbles,
      dribblesCompleted: numbers.dribblesCompleted,
      progressiveActions: numbers.progressiveActions,
      xa: numbers.xa,
      chancesCreated: numbers.chancesCreated,
      touches: numbers.touches,
      touchesFinalThird: numbers.touchesFinalThird,
      touchesBox: numbers.touchesBox,
      shots: numbers.shots,
      shotsOnTarget: numbers.shotsOnTarget,
      goals: numbers.goals,
      xg: numbers.xg,
      npxg: numbers.npxg,
      xgPerShot: numbers.xgPerShot,
      assists: numbers.assists,
      tackles: numbers.tackles,
      tacklesWon: numbers.tacklesWon,
      interceptions: numbers.interceptions,
      pressures: numbers.pressures,
      counterpressures: numbers.counterpressures,
      recoveries: numbers.recoveries,
      blocks: numbers.blocks,
      clearances: numbers.clearances,
      defensiveDuels: numbers.defensiveDuels,
      defensiveDuelsWon: numbers.defensiveDuelsWon,
      aerialDuels: numbers.aerialDuels,
      aerialDuelsWon: numbers.aerialDuelsWon,
      foulsCommitted: numbers.foulsCommitted,
      analyticsVersion: ANALYTICS_VERSION,
      computedAt: new Date(),
    };
  }

  private async computeTeamMatchMetrics(competitionSeasonId: string): Promise<number> {
    const matches = await this.prisma.match.findMany({
      where: { competitionSeasonId },
      select: { id: true, homeTeamId: true, awayTeamId: true },
    });

    let written = 0;

    for (const match of matches) {
      const grouped = await this.prisma.playerMatchMetric.groupBy({
        by: ['teamId'],
        where: { matchId: match.id, analyticsVersion: ANALYTICS_VERSION },
        _sum: {
          passes: true,
          passesCompleted: true,
          progressivePasses: true,
          passesFinalThird: true,
          passesIntoBox: true,
          shots: true,
          shotsOnTarget: true,
          xg: true,
          goals: true,
          pressures: true,
          counterpressures: true,
          recoveries: true,
          tackles: true,
          interceptions: true,
          crosses: true,
          touchesFinalThird: true,
        },
      });

      const totalPasses = grouped.reduce((sum, row) => sum + (row._sum.passes ?? 0), 0);
      const totalFinalThirdTouches = grouped.reduce(
        (sum, row) => sum + (row._sum.touchesFinalThird ?? 0),
        0,
      );

      for (const row of grouped) {
        if (!row.teamId) continue;
        const sums = row._sum;
        const passes = sums.passes ?? 0;

        // PPDA: opponent passes divided by this team's defensive actions in
        // the opponent's build-up. Derivable only with an opponent row.
        const opponent = grouped.find((entry) => entry.teamId && entry.teamId !== row.teamId);
        const defensiveActions =
          (sums.tackles ?? 0) + (sums.interceptions ?? 0) + (sums.pressures ?? 0);
        const ppda =
          opponent && defensiveActions > 0
            ? Math.round(((opponent._sum.passes ?? 0) / defensiveActions) * 100) / 100
            : null;

        const data = {
          possession: totalPasses > 0 ? Math.round((passes / totalPasses) * 1000) / 10 : 0,
          passes,
          passAccuracy:
            passes > 0 ? Math.round(((sums.passesCompleted ?? 0) / passes) * 1000) / 1000 : 0,
          progressivePasses: sums.progressivePasses ?? 0,
          finalThirdEntries: sums.passesFinalThird ?? 0,
          boxEntries: sums.passesIntoBox ?? 0,
          shots: sums.shots ?? 0,
          shotsOnTarget: sums.shotsOnTarget ?? 0,
          xg: Math.round((sums.xg ?? 0) * 1000) / 1000,
          goals: sums.goals ?? 0,
          pressures: sums.pressures ?? 0,
          counterpressures: sums.counterpressures ?? 0,
          recoveries: sums.recoveries ?? 0,
          tackles: sums.tackles ?? 0,
          interceptions: sums.interceptions ?? 0,
          crosses: sums.crosses ?? 0,
          fieldTilt:
            totalFinalThirdTouches > 0
              ? Math.round(((sums.touchesFinalThird ?? 0) / totalFinalThirdTouches) * 1000) / 10
              : 0,
          ppda,
          directness:
            passes > 0
              ? Math.round(((sums.passesFinalThird ?? 0) / passes) * 1000) / 10
              : 0,
          analyticsVersion: ANALYTICS_VERSION,
          computedAt: new Date(),
        };

        await this.prisma.teamMatchMetric.upsert({
          where: {
            teamId_matchId_analyticsVersion: {
              teamId: row.teamId,
              matchId: match.id,
              analyticsVersion: ANALYTICS_VERSION,
            },
          },
          update: data,
          create: { teamId: row.teamId, matchId: match.id, ...data },
        });
        written += 1;
      }
    }

    return written;
  }

  // -------------------------------------------------------------------
  // Season level
  // -------------------------------------------------------------------

  private async computePlayerSeasonMetrics(competitionSeasonId: string): Promise<number> {
    const appearances = await this.prisma.playerMatch.findMany({
      where: { match: { competitionSeasonId } },
      select: {
        playerId: true,
        teamId: true,
        isStarter: true,
        minutesPlayed: true,
        positionGroup: true,
        matchId: true,
        player: { select: { positionGroup: true } },
      },
    });

    const metrics = await this.prisma.playerMatchMetric.findMany({
      where: { match: { competitionSeasonId }, analyticsVersion: ANALYTICS_VERSION },
    });

    const metricByKey = new Map(
      metrics.map((metric) => [`${metric.playerId}:${metric.matchId}`, metric]),
    );

    interface Bucket {
      teamId: string | null;
      positionGroup: string;
      entries: { metrics: PlayerMatchMetrics; isStarter: boolean }[];
    }

    const byPlayer = new Map<string, Bucket>();

    for (const appearance of appearances) {
      if (appearance.minutesPlayed <= 0) continue;

      const row = metricByKey.get(`${appearance.playerId}:${appearance.matchId}`);
      const converted: PlayerMatchMetrics = row
        ? ({ ...emptyMetrics(row.minutes), ...row } as unknown as PlayerMatchMetrics)
        : emptyMetrics(appearance.minutesPlayed);
      converted.minutes = appearance.minutesPlayed;

      const bucket = byPlayer.get(appearance.playerId) ?? {
        teamId: appearance.teamId,
        positionGroup: appearance.positionGroup ?? appearance.player.positionGroup,
        entries: [],
      };
      bucket.entries.push({ metrics: converted, isStarter: appearance.isStarter });
      byPlayer.set(appearance.playerId, bucket);
    }

    let written = 0;

    for (const [playerId, bucket] of byPlayer) {
      const aggregate = aggregateSeason(bucket.entries);
      const rates = seasonPer90(aggregate);
      const quality = assessQuality({
        minutes: aggregate.minutes,
        matches: aggregate.matches,
        coverage: coverageOf({ ...aggregate.available }),
      });

      const data = {
        teamId: bucket.teamId,
        positionGroup: bucket.positionGroup,
        minutes: aggregate.minutes,
        matches: aggregate.matches,
        starts: aggregate.starts,
        ...rates,
        totals: {
          passes: aggregate.passes,
          passesCompleted: aggregate.passesCompleted,
          shots: aggregate.shots,
          goals: aggregate.goals,
          xg: aggregate.xg,
          assists: aggregate.assists,
          tackles: aggregate.tackles,
          interceptions: aggregate.interceptions,
          pressures: aggregate.pressures,
          touches: aggregate.touches,
        } as object,
        confidence: quality.confidence,
        analyticsVersion: ANALYTICS_VERSION,
        computedAt: new Date(),
      };

      await this.prisma.playerSeasonMetric.upsert({
        where: {
          playerId_competitionSeasonId_analyticsVersion: {
            playerId,
            competitionSeasonId,
            analyticsVersion: ANALYTICS_VERSION,
          },
        },
        update: data,
        create: { playerId, competitionSeasonId, ...data },
      });

      // metricKey is null for the whole-profile record, and a nullable column
      // cannot be used in a Prisma compound-unique lookup.
      const qualitySubjectId = `${playerId}:${competitionSeasonId}`;
      const existingQuality = await this.prisma.dataQualityRecord.findFirst({
        where: {
          subjectType: 'PLAYER_SEASON',
          subjectId: qualitySubjectId,
          metricKey: null,
          analyticsVersion: ANALYTICS_VERSION,
        },
        select: { id: true },
      });

      const qualityData = {
        minutes: quality.minutes,
        matches: quality.matches,
        sampleSize: quality.sampleSize,
        confidence: quality.confidence,
      };

      if (existingQuality) {
        await this.prisma.dataQualityRecord.update({
          where: { id: existingQuality.id },
          data: qualityData,
        });
      } else {
        await this.prisma.dataQualityRecord.create({
          data: {
            subjectType: 'PLAYER_SEASON',
            subjectId: qualitySubjectId,
            ...qualityData,
            analyticsVersion: ANALYTICS_VERSION,
          },
        });
      }

      written += 1;
    }

    return written;
  }

  private async computeTeamSeasonMetrics(competitionSeasonId: string): Promise<number> {
    const rows = await this.prisma.teamMatchMetric.groupBy({
      by: ['teamId'],
      where: { match: { competitionSeasonId }, analyticsVersion: ANALYTICS_VERSION },
      _count: { _all: true },
      _avg: {
        possession: true,
        passes: true,
        passAccuracy: true,
        progressivePasses: true,
        xg: true,
        shots: true,
        pressures: true,
        recoveries: true,
        finalThirdEntries: true,
        boxEntries: true,
        fieldTilt: true,
        ppda: true,
        directness: true,
      },
    });

    // xG against needs the opponent's xG, so it is fetched per team.
    let written = 0;

    for (const row of rows) {
      const against = await this.prisma.teamMatchMetric.aggregate({
        where: {
          analyticsVersion: ANALYTICS_VERSION,
          match: {
            competitionSeasonId,
            OR: [{ homeTeamId: row.teamId }, { awayTeamId: row.teamId }],
          },
          teamId: { not: row.teamId },
        },
        _avg: { xg: true },
      });

      const matches = row._count._all;
      const quality = assessQuality({ minutes: matches * 90, matches });

      const data = {
        matches,
        possession: row._avg.possession ?? 0,
        passesP90: row._avg.passes ?? 0,
        passAccuracy: row._avg.passAccuracy ?? 0,
        progressionP90: row._avg.progressivePasses ?? 0,
        xgP90: row._avg.xg ?? 0,
        xgAgainstP90: against._avg.xg ?? 0,
        shotsP90: row._avg.shots ?? 0,
        pressuresP90: row._avg.pressures ?? 0,
        recoveriesP90: row._avg.recoveries ?? 0,
        finalThirdEntriesP90: row._avg.finalThirdEntries ?? 0,
        boxEntriesP90: row._avg.boxEntries ?? 0,
        fieldTilt: row._avg.fieldTilt ?? 0,
        ppda: row._avg.ppda,
        directness: row._avg.directness ?? 0,
        confidence: quality.confidence,
        analyticsVersion: ANALYTICS_VERSION,
        computedAt: new Date(),
      };

      await this.prisma.teamSeasonMetric.upsert({
        where: {
          teamId_competitionSeasonId_analyticsVersion: {
            teamId: row.teamId,
            competitionSeasonId,
            analyticsVersion: ANALYTICS_VERSION,
          },
        },
        update: data,
        create: { teamId: row.teamId, competitionSeasonId, ...data },
      });
      written += 1;
    }

    return written;
  }

  // -------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------

  /**
   * Build the metric inputs for one position group: every player's value plus
   * the population it is ranked against. The population IS the explicit
   * definition required by §26.
   */
  private async metricInputsByGroup(competitionSeasonId: string, minMinutes: number) {
    const rows = await this.prisma.playerSeasonMetric.findMany({
      where: { competitionSeasonId, analyticsVersion: ANALYTICS_VERSION },
    });

    const populations = new Map<string, Map<string, number[]>>();

    for (const row of rows) {
      if (row.minutes < minMinutes) continue;
      const group = populations.get(row.positionGroup) ?? new Map<string, number[]>();

      for (const key of METRIC_KEYS) {
        const value = (row as unknown as Record<string, unknown>)[key];
        if (typeof value !== 'number') continue;
        const list = group.get(key) ?? [];
        list.push(value);
        group.set(key, list);
      }
      populations.set(row.positionGroup, group);
    }

    return { rows, populations };
  }

  private buildInputs(
    row: Record<string, unknown>,
    population: Map<string, number[]>,
  ): MetricInputs {
    const inputs: MetricInputs = {};
    for (const key of METRIC_KEYS) {
      const value = row[key];
      inputs[key] = {
        value: typeof value === 'number' ? value : null,
        population: population.get(key) ?? [],
      };
    }
    return inputs;
  }

  private async computeDnaProfiles(competitionSeasonId: string): Promise<number> {
    const { rows, populations } = await this.metricInputsByGroup(competitionSeasonId, 0);
    let written = 0;

    for (const row of rows) {
      const population = populations.get(row.positionGroup) ?? new Map();
      const inputs = this.buildInputs(row as unknown as Record<string, unknown>, population);
      const dna = computeDna(inputs, row.positionGroup as 'GK' | 'DF' | 'MF' | 'FW');
      const quality = assessQuality({
        minutes: row.minutes,
        matches: row.matches,
        coverage: dna.coverage,
      });

      const data = {
        dna: dna.scores as object,
        styleVector: dna.styleVector as object,
        inputs: {
          categories: dna.categories.map((category) => ({
            category: category.category,
            score: category.score,
            coverage: category.coverage,
            inputs: category.inputs,
          })),
        } as object,
        referencePopulation: `competition_season:${competitionSeasonId}|position_group:${row.positionGroup}`,
        sampleMinutes: row.minutes,
        sampleMatches: row.matches,
        confidence: quality.confidence,
        analyticsVersion: ANALYTICS_VERSION,
        computedAt: new Date(),
      };

      await this.prisma.playerStyleProfile.upsert({
        where: {
          playerId_competitionSeasonId_analyticsVersion: {
            playerId: row.playerId,
            competitionSeasonId,
            analyticsVersion: ANALYTICS_VERSION,
          },
        },
        update: data,
        create: { playerId: row.playerId, competitionSeasonId, ...data },
      });
      written += 1;
    }

    return written;
  }

  private async computeRoleScores(competitionSeasonId: string): Promise<number> {
    const roles = await this.prisma.playerRole.findMany({
      where: { active: true },
      include: { requirements: true },
    });
    if (roles.length === 0) return 0;

    const { rows, populations } = await this.metricInputsByGroup(competitionSeasonId, 0);
    let written = 0;

    for (const row of rows) {
      const population = populations.get(row.positionGroup) ?? new Map();
      const inputs = this.buildInputs(row as unknown as Record<string, unknown>, population);
      const applicable = roles.filter((role) => role.positionGroup === row.positionGroup);
      if (applicable.length === 0) continue;

      const profile = rankRoles(
        applicable.map((role) => ({
          key: role.key,
          name: role.name,
          minMinutes: role.minMinutes,
          requirements: role.requirements.map(
            (requirement): RoleRequirement => ({
              metricKey: requirement.metricKey,
              weight: requirement.weight,
              direction: requirement.direction,
              ...(requirement.minPercentile !== null
                ? { minPercentile: requirement.minPercentile }
                : {}),
            }),
          ),
        })),
        { metrics: inputs, minutes: row.minutes },
      );

      for (const [index, score] of profile.all.entries()) {
        const role = applicable.find((entry) => entry.key === score.roleKey);
        if (!role) continue;

        const quality = assessQuality({
          minutes: row.minutes,
          matches: row.matches,
          coverage: score.coverage,
        });

        const data = {
          score: score.score,
          rank: index + 1,
          isPrimary: index === 0 && score.meetsMinutes,
          confidence: quality.confidence,
          breakdown: score.breakdown as unknown as object,
          sampleMinutes: row.minutes,
          analyticsVersion: ANALYTICS_VERSION,
          computedAt: new Date(),
        };

        await this.prisma.playerRoleScore.upsert({
          where: {
            playerId_playerRoleId_competitionSeasonId_analyticsVersion: {
              playerId: row.playerId,
              playerRoleId: role.id,
              competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
          },
          update: data,
          create: {
            playerId: row.playerId,
            playerRoleId: role.id,
            competitionSeasonId,
            ...data,
          },
        });
        written += 1;
      }
    }

    return written;
  }

  private async computeSimilarity(
    competitionSeasonId: string,
    limitPerPlayer = 10,
  ): Promise<number> {
    const profiles = await this.prisma.playerStyleProfile.findMany({
      where: { competitionSeasonId, analyticsVersion: ANALYTICS_VERSION },
      include: { player: { select: { positionGroup: true } } },
    });

    const candidates = profiles.map((profile) => ({
      playerId: profile.playerId,
      positionGroup: profile.player.positionGroup,
      vector: profile.styleVector as Record<string, number>,
    }));

    let written = 0;

    for (const candidate of candidates) {
      const similar = findSimilarPlayers(candidate, candidates, { limit: limitPerPlayer });

      for (const match of similar) {
        const data = {
          positionGroup: candidate.positionGroup,
          similarity: match.similarity,
          breakdown: {
            agreements: match.agreements,
            differences: match.differences,
            dimensions: match.dimensions,
          } as object,
          analyticsVersion: ANALYTICS_VERSION,
          computedAt: new Date(),
        };

        await this.prisma.playerSimilarity.upsert({
          where: {
            playerId_comparisonPlayerId_competitionSeasonId_analyticsVersion: {
              playerId: candidate.playerId,
              comparisonPlayerId: match.playerId,
              competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
          },
          update: data,
          create: {
            playerId: candidate.playerId,
            comparisonPlayerId: match.playerId,
            competitionSeasonId,
            ...data,
          },
        });
        written += 1;
      }
    }

    return written;
  }

  private async computeTeamStyles(competitionSeasonId: string): Promise<number> {
    const rows = await this.prisma.teamSeasonMetric.findMany({
      where: { competitionSeasonId, analyticsVersion: ANALYTICS_VERSION },
    });
    if (rows.length === 0) return 0;

    const metricKeys = [
      'possession',
      'passesP90',
      'passAccuracy',
      'progressionP90',
      'xgP90',
      'xgAgainstP90',
      'shotsP90',
      'pressuresP90',
      'recoveriesP90',
      'finalThirdEntriesP90',
      'boxEntriesP90',
      'fieldTilt',
      'ppda',
      'directness',
      'crossesP90',
    ];

    const populations = new Map<string, number[]>();
    for (const row of rows) {
      for (const key of metricKeys) {
        const value = (row as unknown as Record<string, unknown>)[key];
        if (typeof value !== 'number') continue;
        populations.set(key, [...(populations.get(key) ?? []), value]);
      }
    }

    let written = 0;

    for (const row of rows) {
      const inputs: Record<string, StyleInput> = {};
      for (const key of metricKeys) {
        const value = (row as unknown as Record<string, unknown>)[key];
        inputs[key] = {
          value: typeof value === 'number' ? value : null,
          population: populations.get(key) ?? [],
        };
      }

      const style = computeTeamStyle(inputs);
      const quality = assessQuality({
        minutes: row.matches * 90,
        matches: row.matches,
        coverage: style.coverage,
      });

      const data = {
        style: style.style as object,
        inputs: style.inputs as object,
        sampleMatches: row.matches,
        confidence: quality.confidence,
        analyticsVersion: ANALYTICS_VERSION,
        computedAt: new Date(),
      };

      await this.prisma.teamStyleProfile.upsert({
        where: {
          teamId_competitionSeasonId_analyticsVersion: {
            teamId: row.teamId,
            competitionSeasonId,
            analyticsVersion: ANALYTICS_VERSION,
          },
        },
        update: data,
        create: { teamId: row.teamId, competitionSeasonId, ...data },
      });
      written += 1;
    }

    return written;
  }

  private async computeClubFits(competitionSeasonId: string): Promise<number> {
    const [profiles, teams] = await Promise.all([
      this.prisma.playerStyleProfile.findMany({
        where: { competitionSeasonId, analyticsVersion: ANALYTICS_VERSION },
        select: { playerId: true, dna: true },
      }),
      this.prisma.teamStyleProfile.findMany({
        where: { competitionSeasonId, analyticsVersion: ANALYTICS_VERSION },
        select: { teamId: true, style: true },
      }),
    ]);

    let written = 0;

    for (const profile of profiles) {
      for (const team of teams) {
        const fit = computeClubFit(
          profile.dna as Record<string, number>,
          team.style as Record<string, number>,
        );

        const data = {
          fitScore: fit.fitScore,
          breakdown: {
            components: fit.components,
            strengths: fit.strengths,
            gaps: fit.gaps,
            note: fit.note,
          } as object,
          analyticsVersion: ANALYTICS_VERSION,
          computedAt: new Date(),
        };

        await this.prisma.playerFitScore.upsert({
          where: {
            playerId_teamId_competitionSeasonId_analyticsVersion: {
              playerId: profile.playerId,
              teamId: team.teamId,
              competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
          },
          update: data,
          create: {
            playerId: profile.playerId,
            teamId: team.teamId,
            competitionSeasonId,
            ...data,
          },
        });
        written += 1;
      }
    }

    return written;
  }

  /** Refresh the materialized views (§22). */
  async refreshMaterializedViews(): Promise<string[]> {
    const views = [
      'mv_player_season_metrics',
      'mv_player_percentiles',
      'mv_team_style_profiles',
      'mv_player_similarity',
      'mv_heatmap_zone_stats',
    ];

    const refreshed: string[] = [];
    for (const view of views) {
      // CONCURRENTLY needs a unique index and a previously populated view; the
      // plain form is correct here and always available.
      await this.prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${view}`);
      refreshed.push(view);
    }

    logger.info({ views: refreshed }, 'materialized views refreshed');
    return refreshed;
  }
}

const coverageOf = (available: Record<string, boolean>): number => {
  const values = Object.values(available);
  if (values.length === 0) return 0;
  return values.filter(Boolean).length / values.length;
};

export const CONFIDENCE_ORDER: Confidence[] = [
  Confidence.INSUFFICIENT,
  Confidence.LOW,
  Confidence.MEDIUM,
  Confidence.HIGH,
];

export const eventTypeLabel = (type: EventType): string =>
  type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
