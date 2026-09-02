import { readFile } from 'node:fs/promises';
import { ReportType, type PrismaClient, type ReportStatus } from '@prisma/client';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma as defaultPrisma } from '@/db/client';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getStorage, type Storage } from '@/lib/storage';
import { buildPlayerReportBlocks, type PlayerReportData } from '@/reports/blocks';
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

    const config = getConfig();
    const data = await this.collectPlayerData(options.playerId, options.competitionSeasonId);
    const title = options.title ?? `Scouting report - ${data.player.fullName}`;

    const blocks = buildPlayerReportBlocks(data, {
      title,
      ...(options.summary ? { summary: options.summary } : {}),
      ...(options.recommendation ? { recommendation: options.recommendation } : {}),
    });

    const providers = await collectProviders(this.prisma);
    const meta = buildSnapshotMeta({ data, blocks }, providers);

    const report = await this.prisma.report.create({
      data: {
        type: options.type ?? ReportType.PLAYER,
        title,
        status: options.status ?? 'DRAFT',
        authorId: options.authorId ?? null,
        subjectPlayerId: options.playerId,
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
        subject: data.player.fullName,
        subtitle: data.season ? `${data.season.competition} ${data.season.name}` : undefined,
        isDemo: data.player.isDemo,
        blocks,
        quality: data.quality,
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
