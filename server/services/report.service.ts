import { readFile } from 'node:fs/promises';
import { ReportType, type PrismaClient, type ReportStatus } from '@prisma/client';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma as defaultPrisma } from '@/db/client';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getStorage, type Storage } from '@/lib/storage';
import {
  buildClubReportBlocks,
  buildComparisonReportBlocks,
  buildMatchReportBlocks,
  buildPlayerReportBlocks,
  type Block,
  type ClubReportData,
  type ComparisonReportData,
  type MatchReportData,
  type PlayerReportData,
} from '@/reports/blocks';
import { htmlToPdf, PdfUnavailableError } from '@/reports/pdf';
import { renderReportHtml } from '@/reports/render';
import { buildSnapshotMeta, collectProviders } from '@/reports/snapshot';
import { HeatmapService } from '@/server/services/heatmap.service';

/**
 * Report engine (§50, §51, §52, §86).
 *
 * Generating a report:
 *   1. gather every input into one payload
 *   2. freeze it as a report version with an analytics version and snapshot id
 *   3. render HTML from the FROZEN payload (never from live queries)
 *   4. render the PDF from that HTML
 *
 * Re-rendering an old version reproduces the original document exactly, which
 * is the whole point of §52.
 */

export interface GenerateReportOptions {
  playerId?: string;
  /** Two to five players, for a comparison report (§43, §51). */
  playerIds?: string[];
  teamId?: string;
  matchId?: string;
  type?: ReportType;
  title?: string;
  summary?: string;
  recommendation?: string;
  competitionSeasonId?: string;
  authorId?: string;
  status?: ReportStatus;
  includePdf?: boolean;
}

export interface GeneratedReport {
  reportId: string;
  versionId: string;
  version: number;
  htmlPath: string;
  pdfPath: string | null;
  dataSnapshotId: string;
  pdfError?: string;
}

export class ReportService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly storage: Storage = getStorage(),
  ) {}

  /** Collect everything a player report needs, as one plain payload. */
  async collectPlayerData(
    playerId: string,
    competitionSeasonId?: string,
  ): Promise<PlayerReportData> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      include: {
        country: { select: { name: true } },
        memberships: {
          where: { endDate: null },
          include: { team: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const seasonMetric = await this.prisma.playerSeasonMetric.findFirst({
      where: {
        playerId,
        analyticsVersion: ANALYTICS_VERSION,
        ...(competitionSeasonId ? { competitionSeasonId } : {}),
      },
      include: {
        season: { include: { competition: { select: { name: true } } } },
        team: { select: { name: true } },
      },
      orderBy: { minutes: 'desc' },
    });

    const seasonId = seasonMetric?.competitionSeasonId ?? competitionSeasonId ?? null;

    const [percentiles, style, roles, similar, fits, notes, ratings] = await Promise.all([
      seasonId
        ? this.prisma.$queryRaw<{ metric_key: string; value: number; percentile: number }[]>`
            SELECT metric_key, value, percentile
            FROM vw_player_percentiles
            WHERE player_id = ${playerId}
              AND competition_season_id = ${seasonId}
              AND analytics_version = ${ANALYTICS_VERSION}
            ORDER BY percentile DESC
          `
        : Promise.resolve([]),
      seasonId
        ? this.prisma.playerStyleProfile.findFirst({
            where: { playerId, competitionSeasonId: seasonId, analyticsVersion: ANALYTICS_VERSION },
          })
        : Promise.resolve(null),
      this.prisma.playerRoleScore.findMany({
        where: {
          playerId,
          analyticsVersion: ANALYTICS_VERSION,
          ...(seasonId ? { competitionSeasonId: seasonId } : {}),
        },
        include: { role: { select: { name: true } } },
        orderBy: { score: 'desc' },
        take: 6,
      }),
      this.prisma.playerSimilarity.findMany({
        where: {
          playerId,
          analyticsVersion: ANALYTICS_VERSION,
          ...(seasonId ? { competitionSeasonId: seasonId } : {}),
        },
        include: {
          comparison: {
            select: {
              fullName: true,
              memberships: {
                where: { endDate: null },
                include: { team: { select: { name: true } } },
                take: 1,
              },
            },
          },
        },
        orderBy: { similarity: 'desc' },
        take: 8,
      }),
      this.prisma.playerFitScore.findMany({
        where: {
          playerId,
          analyticsVersion: ANALYTICS_VERSION,
          ...(seasonId ? { competitionSeasonId: seasonId } : {}),
        },
        include: { team: { select: { name: true } } },
        orderBy: { fitScore: 'desc' },
        take: 8,
      }),
      this.prisma.scoutingNote.findMany({
        where: { playerId },
        include: { author: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.scoutRating.findMany({
        where: { playerId },
        include: { author: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const heatmapService = new HeatmapService(this.prisma);
    const heatmap = await heatmapService
      .build({
        playerId,
        type: 'TOUCH',
        algorithm: 'GAUSSIAN_KDE',
        cols: 24,
        rows: 16,
        ...(seasonId ? { competitionSeasonId: seasonId } : {}),
      })
      .catch(() => null);

    const shots = await this.prisma.event.findMany({
      where: {
        playerId,
        type: 'SHOT',
        ...(seasonId ? { match: { competitionSeasonId: seasonId } } : {}),
        x: { not: null },
        y: { not: null },
      },
      select: { x: true, y: true, shot: { select: { xg: true, isGoal: true, onTarget: true } } },
      take: 400,
    });

    const metrics: Record<string, number> = {};
    if (seasonMetric) {
      for (const [key, value] of Object.entries(seasonMetric)) {
        if (typeof value === 'number' && key.endsWith('P90')) metrics[key] = value;
      }
      metrics.minutes = seasonMetric.minutes;
      metrics.matches = seasonMetric.matches;
    }

    return {
      player: {
        id: player.id,
        fullName: player.fullName,
        age: ageOf(player.dateOfBirth),
        nationality: player.country?.name ?? null,
        position: player.primaryPosition,
        positionGroup: player.positionGroup,
        preferredFoot: player.preferredFoot,
        heightCm: player.heightCm,
        teamName:
          seasonMetric?.team?.name ?? player.memberships[0]?.team.name ?? null,
        isDemo: player.isDemo,
      },
      season: seasonMetric
        ? {
            id: seasonMetric.competitionSeasonId,
            name: seasonMetric.season.seasonName,
            competition: seasonMetric.season.competition.name,
          }
        : null,
      metrics: seasonMetric ? metrics : null,
      percentiles: percentiles.map((entry) => ({
        metricKey: entry.metric_key,
        value: Number(entry.value),
        percentile: Number(entry.percentile),
      })),
      dna: (style?.dna as Record<string, number> | undefined) ?? null,
      dnaInputs: style?.inputs ?? null,
      roles: roles.map((role) => ({
        roleName: role.role.name,
        score: role.score,
        isPrimary: role.isPrimary,
        breakdown: role.breakdown,
      })),
      similar: similar.map((entry) => ({
        playerName: entry.comparison.fullName,
        teamName: entry.comparison.memberships[0]?.team.name ?? null,
        similarity: entry.similarity,
      })),
      clubFit: fits.map((fit) => ({
        teamName: fit.team.name,
        fitScore: fit.fitScore,
        note: (fit.breakdown as { note?: string })?.note ?? '',
      })),
      notes: notes.map((note) => ({
        author: note.author.displayName,
        createdAt: note.createdAt.toISOString(),
        minute: note.minute,
        body: note.body,
      })),
      scoutRatings: ratings.map((rating) => ({
        author: rating.author.displayName,
        technical: rating.technical,
        tactical: rating.tactical,
        physical: rating.physical,
        mental: rating.mental,
        potential: rating.potential,
        overall: rating.overall,
      })),
      quality: {
        minutes: seasonMetric?.minutes ?? 0,
        matches: seasonMetric?.matches ?? 0,
        confidence: seasonMetric?.confidence ?? 'INSUFFICIENT',
        summary: seasonMetric
          ? `Confidence: ${titleCase(seasonMetric.confidence)} - ${seasonMetric.minutes} minutes across ${seasonMetric.matches} matches`
          : 'No season metrics available for this player yet',
      },
      heatmap: heatmap
        ? {
            cols: heatmap.cols,
            rows: heatmap.rows,
            cells: heatmap.cells.map((cell) => ({ x: cell.x, y: cell.y, value: cell.value })),
          }
        : null,
      shots: shots
        .filter((shot) => shot.x !== null && shot.y !== null && shot.shot)
        .map((shot) => ({
          x: shot.x as number,
          y: shot.y as number,
          xg: shot.shot?.xg ?? 0,
          isGoal: shot.shot?.isGoal ?? false,
          onTarget: shot.shot?.onTarget ?? false,
        })),
    };
  }

  async generatePlayerReport(options: GenerateReportOptions): Promise<GeneratedReport> {
    if (!options.playerId) throw new Error('playerId is required for a player report');

    const data = await this.collectPlayerData(options.playerId, options.competitionSeasonId);
    const title = options.title ?? `Scouting report - ${data.player.fullName}`;

    return this.persist({
      options,
      type: options.type ?? ReportType.PLAYER,
      title,
      subject: data.player.fullName,
      ...(data.season ? { subtitle: `${data.season.competition} ${data.season.name}` } : {}),
      isDemo: data.player.isDemo,
      subjectIds: { subjectPlayerId: options.playerId },
      data,
      quality: data.quality,
      blocks: buildPlayerReportBlocks(data, {
        title,
        ...(options.summary ? { summary: options.summary } : {}),
        ...(options.recommendation ? { recommendation: options.recommendation } : {}),
      }),
    });
  }

  /**
   * Freeze, store and render a report (§52, §86).
   *
   * Every report type shares this: the snapshot is written before anything is
   * rendered, so a failed PDF never costs the report.
   */
  private async persist(input: {
    options: GenerateReportOptions;
    type: ReportType;
    title: string;
    subject: string;
    subtitle?: string;
    isDemo: boolean;
    subjectIds: {
      subjectPlayerId?: string;
      subjectTeamId?: string;
      subjectMatchId?: string;
    };
    data: unknown;
    quality: { summary: string; confidence?: string };
    blocks: Block[];
  }): Promise<GeneratedReport> {
    const { options, title, blocks, data } = input;
    const config = getConfig();

    const providers = await collectProviders(this.prisma);
    const meta = buildSnapshotMeta({ data, blocks }, providers);

    const report = await this.prisma.report.create({
      data: {
        type: input.type,
        title,
        status: options.status ?? 'DRAFT',
        authorId: options.authorId ?? null,
        ...input.subjectIds,
      },
    });

    const version = await this.prisma.reportVersion.create({
      data: {
        reportId: report.id,
        version: 1,
        dataSnapshotId: meta.dataSnapshotId,
        analyticsVersion: meta.analyticsVersion,
        reportVersion: meta.reportVersion,
        // The frozen payload: everything the renderer used (§86).
        snapshot: { data, blocks, meta } as unknown as object,
        providerVersions: providers as unknown as object,
        createdById: options.authorId ?? null,
      },
    });

    await this.prisma.reportBlock.createMany({
      data: blocks.map((block, index) => ({
        reportVersionId: version.id,
        order: index,
        type: block.type,
        title: block.title ?? null,
        content: block.content as object,
      })),
    });

    const html = renderReportHtml(
      {
        title,
        subject: input.subject,
        subtitle: input.subtitle,
        isDemo: input.isDemo,
        blocks,
        quality: input.quality,
      },
      {
        organisation: config.reports.organisation,
        baseUrl: config.http.publicBaseUrl,
        meta,
        ...(await this.logoDataUri()),
      },
    );

    const htmlKey = `${report.id}/v1.html`;
    await this.storage.write('reports', htmlKey, html);

    let pdfKey: string | null = null;
    let pdfError: string | undefined;

    if (options.includePdf !== false && config.reports.pdfEnabled) {
      try {
        const pdf = await htmlToPdf(html, {
          headerText: title,
          footerText: `${config.reports.organisation} - ${meta.generatedAt.slice(0, 10)}`,
        });
        pdfKey = `${report.id}/v1.pdf`;
        await this.storage.write('reports', pdfKey, pdf);
        await this.storage.archive('reports', pdfKey).catch(() => null);
      } catch (error) {
        // A missing browser must not lose the report: the HTML is already
        // stored and the PDF can be produced later.
        pdfError =
          error instanceof PdfUnavailableError
            ? error.message
            : error instanceof Error
              ? error.message
              : String(error);
        logger.warn({ reportId: report.id, err: pdfError }, 'pdf generation failed');
      }
    }

    await this.prisma.reportVersion.update({
      where: { id: version.id },
      data: { htmlPath: htmlKey, pdfPath: pdfKey },
    });

    await this.storage.archive('reports', htmlKey).catch(() => null);

    return {
      reportId: report.id,
      versionId: version.id,
      version: 1,
      htmlPath: htmlKey,
      pdfPath: pdfKey,
      dataSnapshotId: meta.dataSnapshotId,
      ...(pdfError ? { pdfError } : {}),
    };
  }

  async generateClubReport(options: GenerateReportOptions): Promise<GeneratedReport> {
    if (!options.teamId) throw new Error('teamId is required for a club report');

    const data = await this.collectClubData(options.teamId, options.competitionSeasonId);
    const title = options.title ?? `Club report - ${data.team.name}`;

    return this.persist({
      options,
      type: ReportType.CLUB,
      title,
      subject: data.team.name,
      ...(data.season ? { subtitle: `${data.season.competition} ${data.season.name}` } : {}),
      isDemo: data.team.isDemo,
      subjectIds: { subjectTeamId: options.teamId },
      data,
      quality: data.quality,
      blocks: buildClubReportBlocks(data, {
        title,
        ...(options.summary ? { summary: options.summary } : {}),
        ...(options.recommendation ? { recommendation: options.recommendation } : {}),
      }),
    });
  }

  async generateMatchReport(options: GenerateReportOptions): Promise<GeneratedReport> {
    if (!options.matchId) throw new Error('matchId is required for a match report');

    const data = await this.collectMatchData(options.matchId);
    const title =
      options.title ?? `Match report - ${data.match.homeTeam} v ${data.match.awayTeam}`;

    return this.persist({
      options,
      type: ReportType.MATCH,
      title,
      subject: `${data.match.homeTeam} ${data.match.score} ${data.match.awayTeam}`,
      subtitle: `${data.match.competition} ${data.match.season}`,
      isDemo: data.match.isDemo,
      subjectIds: { subjectMatchId: options.matchId },
      data,
      quality: data.quality,
      blocks: buildMatchReportBlocks(data, {
        title,
        ...(options.summary ? { summary: options.summary } : {}),
      }),
    });
  }

  async generateComparisonReport(options: GenerateReportOptions): Promise<GeneratedReport> {
    const ids = options.playerIds ?? [];
    if (ids.length < 2) throw new Error('A comparison report needs at least two players');

    const data = await this.collectComparisonData(ids);
    const names = data.players.map((player) => player.fullName);
    const title = options.title ?? `Comparison - ${names.join(' v ')}`;

    return this.persist({
      options,
      type: ReportType.PLAYER_COMPARISON,
      title,
      subject: names.join(' · '),
      ...(data.players[0]?.season ? { subtitle: data.players[0].season } : {}),
      isDemo: false,
      subjectIds: { subjectPlayerId: ids[0] as string },
      data,
      quality: data.quality,
      blocks: buildComparisonReportBlocks(data, {
        title,
        ...(options.summary ? { summary: options.summary } : {}),
        ...(options.recommendation ? { recommendation: options.recommendation } : {}),
      }),
    });
  }

  private async collectClubData(
    teamId: string,
    competitionSeasonId?: string,
  ): Promise<ClubReportData> {
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: { country: { select: { name: true } } },
    });

    const seasonMetric = await this.prisma.teamSeasonMetric.findFirst({
      where: {
        teamId,
        analyticsVersion: ANALYTICS_VERSION,
        ...(competitionSeasonId ? { competitionSeasonId } : {}),
      },
      include: { season: { include: { competition: { select: { name: true } } } } },
      orderBy: { matches: 'desc' },
    });

    const [style, squad, matches] = await Promise.all([
      seasonMetric
        ? this.prisma.teamStyleProfile.findFirst({
            where: {
              teamId,
              competitionSeasonId: seasonMetric.competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
          })
        : Promise.resolve(null),
      seasonMetric
        ? this.prisma.playerSeasonMetric.findMany({
            where: {
              teamId,
              competitionSeasonId: seasonMetric.competitionSeasonId,
              analyticsVersion: ANALYTICS_VERSION,
            },
            include: { player: { select: { fullName: true, primaryPosition: true } } },
            orderBy: { minutes: 'desc' },
            take: 30,
          })
        : Promise.resolve([]),
      this.prisma.teamMatchMetric.findMany({
        where: {
          teamId,
          analyticsVersion: ANALYTICS_VERSION,
          ...(seasonMetric
            ? { match: { competitionSeasonId: seasonMetric.competitionSeasonId } }
            : {}),
        },
        include: {
          match: {
            select: {
              kickoffAt: true,
              homeScore: true,
              awayScore: true,
              homeTeamId: true,
              homeTeam: { select: { name: true } },
              awayTeam: { select: { name: true } },
            },
          },
        },
        orderBy: { match: { kickoffAt: 'asc' } },
      }),
    ]);

    const metrics: Record<string, number> = {};
    if (seasonMetric) {
      const row = seasonMetric as unknown as Record<string, unknown>;
      for (const key of [
        'possession',
        'xgP90',
        'xgAgainstP90',
        'shotsP90',
        'progressionP90',
        'finalThirdEntriesP90',
        'boxEntriesP90',
        'fieldTilt',
        'passAccuracy',
        'pressuresP90',
        'ppda',
        'directness',
      ]) {
        const value = row[key];
        if (typeof value === 'number') metrics[key] = value;
      }
    }

    return {
      team: {
        id: team.id,
        name: team.name,
        country: team.country?.name ?? null,
        isDemo: team.isDemo,
      },
      season: seasonMetric
        ? {
            id: seasonMetric.competitionSeasonId,
            name: seasonMetric.season.seasonName,
            competition: seasonMetric.season.competition.name,
          }
        : null,
      metrics: Object.keys(metrics).length > 0 ? metrics : null,
      style: (style?.style as Record<string, number> | undefined) ?? null,
      squad: squad.map((entry) => ({
        playerName: entry.player.fullName,
        position: entry.player.primaryPosition,
        minutes: entry.minutes,
        goalsP90: entry.goalsP90,
        xgP90: entry.xgP90,
        xaP90: entry.xaP90,
      })),
      matches: matches.map((entry) => {
        const home = entry.match.homeTeamId === teamId;
        return {
          date: entry.match.kickoffAt.toISOString().slice(0, 10),
          opponent: home ? entry.match.awayTeam.name : entry.match.homeTeam.name,
          homeAway: home ? 'H' : 'A',
          score: `${entry.match.homeScore ?? '-'}-${entry.match.awayScore ?? '-'}`,
          xg: entry.xg,
          possession: entry.possession,
        };
      }),
      quality: {
        matches: seasonMetric?.matches ?? 0,
        confidence: seasonMetric?.confidence ?? 'INSUFFICIENT',
        summary: seasonMetric
          ? `Computed from ${seasonMetric.matches} matches; confidence ${seasonMetric.confidence.toLowerCase()}.`
          : 'No season metrics have been computed for this club yet.',
      },
    };
  }

  private async collectMatchData(matchId: string): Promise<MatchReportData> {
    const match = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        season: { include: { competition: { select: { name: true } } } },
      },
    });

    const [teamMetrics, shots, lineups, eventCount] = await Promise.all([
      this.prisma.teamMatchMetric.findMany({
        where: { matchId, analyticsVersion: ANALYTICS_VERSION },
      }),
      this.prisma.event.findMany({
        where: { matchId, type: 'SHOT', x: { not: null }, y: { not: null } },
        select: { x: true, y: true, teamId: true, shot: true },
        take: 200,
      }),
      this.prisma.playerMatch.findMany({
        where: { matchId },
        include: {
          player: { select: { fullName: true } },
          team: { select: { name: true } },
        },
        orderBy: [{ teamId: 'asc' }, { minutesPlayed: 'desc' }],
      }),
      this.prisma.event.count({ where: { matchId } }),
    ]);

    const home = teamMetrics.find((metric) => metric.teamId === match.homeTeamId);
    const away = teamMetrics.find((metric) => metric.teamId === match.awayTeamId);

    const compare = (key: string): { key: string; home: number; away: number } => ({
      key,
      home: ((home as unknown as Record<string, number> | undefined)?.[key] ?? 0),
      away: ((away as unknown as Record<string, number> | undefined)?.[key] ?? 0),
    });

    const network = await this.networkFor(matchId, match.homeTeamId, match.homeTeam.name);

    return {
      match: {
        id: match.id,
        kickoff: match.kickoffAt.toISOString(),
        competition: match.season.competition.name,
        season: match.season.seasonName,
        homeTeam: match.homeTeam.name,
        awayTeam: match.awayTeam.name,
        score: `${match.homeScore ?? '-'} - ${match.awayScore ?? '-'}`,
        isDemo: match.isDemo,
      },
      teamMetrics:
        home && away
          ? [
              'possession',
              'xg',
              'shots',
              'shotsOnTarget',
              'passes',
              'passAccuracy',
              'progressivePasses',
              'finalThirdEntries',
              'boxEntries',
              'fieldTilt',
              'pressures',
              'recoveries',
              'ppda',
            ].map(compare)
          : [],
      shots: shots
        .filter((shot) => shot.x !== null && shot.y !== null)
        .map((shot) => ({
          // Away shots are mirrored so both teams attack the same goal.
          x: shot.teamId === match.homeTeamId ? (shot.x as number) : 105 - (shot.x as number),
          y: shot.teamId === match.homeTeamId ? (shot.y as number) : 68 - (shot.y as number),
          xg: shot.shot?.xg ?? 0,
          isGoal: shot.shot?.isGoal ?? false,
          onTarget: shot.shot?.onTarget ?? false,
        })),
      lineups: lineups.map((entry) => ({
        team: entry.team.name,
        playerName: entry.player.fullName,
        position: entry.position,
        minutes: entry.minutesPlayed,
      })),
      network,
      quality: {
        events: eventCount,
        confidence: home && away ? 'HIGH' : 'INSUFFICIENT',
        summary:
          home && away
            ? `Derived from ${eventCount} recorded events.`
            : `Only ${eventCount} events are recorded and no team metrics have been computed, so the comparison below is empty.`,
      },
    };
  }

  /** Passing network for the report, reusing the same aggregation as the app. */
  private async networkFor(
    matchId: string,
    teamId: string,
    teamName: string,
  ): Promise<MatchReportData['network']> {
    const { NetworkService } = await import('@/server/services/network.service');
    const result = await new NetworkService(this.prisma).passingNetwork({ matchId, teamId });
    if (result.nodes.length === 0) return null;

    const names = new Map(result.nodes.map((node) => [node.playerId, node.name]));
    return {
      team: teamName,
      nodes: result.nodes.map((node) => ({
        name: node.name,
        passes: node.passes,
        received: node.received,
      })),
      edges: result.edges.map((edge) => ({
        from: names.get(edge.from) ?? '?',
        to: names.get(edge.to) ?? '?',
        passes: edge.passes,
      })),
    };
  }

  private async collectComparisonData(ids: string[]): Promise<ComparisonReportData> {
    const { ComparisonService } = await import('@/server/services/comparison.service');
    const comparison = await new ComparisonService(this.prisma).comparePlayers(ids);

    return {
      players: comparison.players.map((player) => ({
        id: player.id,
        fullName: player.fullName,
        position: player.primaryPosition ?? '-',
        positionGroup: player.positionGroup ?? '-',
        age: player.age,
        teamName: player.club,
        season: player.season
          ? `${player.season.competitionName} ${player.season.seasonName}`
          : null,
        minutes: player.season?.minutes ?? 0,
        confidence: player.season?.confidence ?? 'INSUFFICIENT',
        metrics: player.metrics,
        percentiles: Object.fromEntries(
          Object.entries(player.percentiles).map(([key, entry]) => [key, entry.percentile]),
        ),
        dna: player.dna,
        topRole: player.roles[0]?.name ?? null,
      })),
      sharedPopulation: comparison.sharedPopulation,
      metricKeys: comparison.metricKeys,
      quality: {
        summary: comparison.players
          .map(
            (player) =>
              `${player.fullName}: ${player.season?.minutes ?? 0} minutes, confidence ${(
                player.season?.confidence ?? 'insufficient'
              ).toLowerCase()}.`,
          )
          .join(' '),
      },
    };
  }

  /**
   * Re-render an existing version from its frozen snapshot (§52).
   * Produces the same document regardless of later analytics changes.
   */
  async renderStoredVersion(versionId: string): Promise<string> {
    const version = await this.prisma.reportVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { report: true },
    });

    const snapshot = version.snapshot as unknown as {
      data: PlayerReportData;
      blocks: Parameters<typeof renderReportHtml>[0]['blocks'];
      meta: Parameters<typeof renderReportHtml>[1]['meta'];
    };

    const config = getConfig();

    return renderReportHtml(
      {
        title: version.report.title,
        subject: snapshot.data.player.fullName,
        subtitle: snapshot.data.season
          ? `${snapshot.data.season.competition} ${snapshot.data.season.name}`
          : undefined,
        isDemo: snapshot.data.player.isDemo,
        blocks: snapshot.blocks,
        quality: snapshot.data.quality,
      },
      {
        organisation: config.reports.organisation,
        baseUrl: config.http.publicBaseUrl,
        meta: snapshot.meta,
        ...(await this.logoDataUri()),
      },
    );
  }

  async readArtifact(versionId: string, kind: 'html' | 'pdf'): Promise<Buffer | null> {
    const version = await this.prisma.reportVersion.findUnique({ where: { id: versionId } });
    const key = kind === 'pdf' ? version?.pdfPath : version?.htmlPath;
    if (!key) return null;
    if (!(await this.storage.exists('reports', key))) return null;
    return this.storage.read('reports', key);
  }

  private async logoDataUri(): Promise<{ logoDataUri?: string }> {
    const path = getConfig().reports.logoPath;
    if (!path) return {};

    try {
      const bytes = await readFile(path);
      const mime = path.endsWith('.svg')
        ? 'image/svg+xml'
        : path.endsWith('.jpg') || path.endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png';
      return { logoDataUri: `data:${mime};base64,${bytes.toString('base64')}` };
    } catch {
      // A missing logo is cosmetic; never fail a report over it.
      return {};
    }
  }
}

const ageOf = (dateOfBirth: Date | null): number | null => {
  if (!dateOfBirth) return null;
  return Math.floor((Date.now() - dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
};

const titleCase = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase();
