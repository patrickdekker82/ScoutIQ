import type { PrismaClient } from '@prisma/client';
import { getConfig } from '../config/env.js';
import { renderReport, reportKey, type ReportMetrics } from '../domain/report.js';
import { logger } from '../lib/logger.js';
import { getPrisma } from '../lib/prisma.js';
import { getStorage, type Storage } from '../lib/storage.js';

export interface CreateReportInput {
  playerId: string;
  authorId?: string | null;
  title: string;
  summary: string;
  rating: number;
  season?: string;
  publish?: boolean;
}

/**
 * Creates scouting reports and renders them under REPORT_ROOT.
 *
 * Only the *relative* key is stored in the database, so moving REPORT_ROOT to
 * a different mount (or a different machine) never invalidates existing rows.
 */
export class ReportService {
  constructor(
    private readonly prisma: PrismaClient = getPrisma(),
    private readonly storage: Storage = getStorage(),
  ) {}

  async create(input: CreateReportInput) {
    const player = await this.prisma.player.findUnique({
      where: { id: input.playerId },
      include: { team: true, metrics: { orderBy: { season: 'desc' }, take: 5 } },
    });
    if (!player) throw new Error(`Unknown player: ${input.playerId}`);

    const season = input.season ?? player.metrics[0]?.season ?? 'unknown';
    const metricRow = player.metrics.find((metric) => metric.season === season) ?? null;

    const report = await this.prisma.scoutingReport.create({
      data: {
        playerId: player.id,
        authorId: input.authorId ?? null,
        title: input.title,
        summary: input.summary,
        rating: input.rating,
        status: input.publish ? 'PUBLISHED' : 'DRAFT',
      },
      include: { author: true },
    });

    const metrics: ReportMetrics | null = metricRow
      ? {
          season: metricRow.season,
          matches: metricRow.matches,
          minutesPlayed: metricRow.minutesPlayed,
          goalsPer90: metricRow.goalsPer90,
          assistsPer90: metricRow.assistsPer90,
          xgPer90: metricRow.xgPer90,
          xaPer90: metricRow.xaPer90,
          passAccuracy: metricRow.passAccuracy,
          progPassPer90: metricRow.progPassPer90,
          duelWinRate: metricRow.duelWinRate,
          scoutScore: metricRow.scoutScore,
        }
      : null;

    const document = renderReport({
      title: report.title,
      summary: report.summary,
      rating: report.rating,
      author: report.author?.displayName ?? null,
      generatedAt: report.createdAt,
      reportId: report.id,
      baseUrl: getConfig().http.publicBaseUrl,
      player: {
        firstName: player.firstName,
        lastName: player.lastName,
        position: player.position,
        nationality: player.nationality,
        teamName: player.team?.name ?? null,
      },
      metrics,
    });

    const key = reportKey(season, player.id, report.id);
    await this.storage.write('reports', key, document);
    await this.storage.archive('reports', key).catch(() => null);

    logger.info({ reportId: report.id, key }, 'report rendered');

    return this.prisma.scoutingReport.update({
      where: { id: report.id },
      data: { filePath: key },
    });
  }

  async readDocument(reportId: string): Promise<string | null> {
    const report = await this.prisma.scoutingReport.findUnique({ where: { id: reportId } });
    if (!report?.filePath) return null;
    if (!(await this.storage.exists('reports', report.filePath))) return null;
    return (await this.storage.read('reports', report.filePath)).toString('utf8');
  }
}
