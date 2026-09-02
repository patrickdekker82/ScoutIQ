import { spawn } from 'node:child_process';
import { Worker, type Job } from 'bullmq';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { createRedis } from '@/lib/redis';
import { availableProviders, createProvider } from '@/providers';
import { AnalyticsService } from '@/server/services/analytics.service';
import { ExportService } from '@/server/services/export.service';
import { ImportService } from '@/server/services/import.service';
import { ReportService } from '@/server/services/report.service';
import { syncService } from '@/server/services/sync.service';
import { audit } from '@/server/audit';
import {
  QUEUE_ANALYTICS,
  QUEUE_EXPORT,
  QUEUE_IMPORT,
  QUEUE_MAINTENANCE,
  QUEUE_PREFIX,
  QUEUE_REPORT,
  type AnalyticsJobData,
  type ExportJobData,
  type ImportJobData,
  type MaintenanceJobData,
  type ReportJobData,
} from '@/jobs/queues';

/**
 * Worker processes (§56).
 *
 * Heavy work - imports, analytics, exports, PDF rendering - runs here, never in
 * a request. Scale by running more replicas: nothing assumes it is the only
 * worker, and nothing assumes it shares a filesystem with the web process
 * beyond the configured storage roots.
 */

export function startWorkers(): Worker[] {
  const { scheduler } = getConfig();
  const connection = () => createRedis();
  const common = { prefix: QUEUE_PREFIX, concurrency: scheduler.concurrency };

  const importService = new ImportService();
  const analyticsService = new AnalyticsService();
  const exportService = new ExportService();
  const reportService = new ReportService();

  const importWorker = new Worker<ImportJobData>(
    QUEUE_IMPORT,
    async (job) => {
      // External API synchronisation (§88 phase 8). A schedule owns its own
      // watermark and failure state, so those jobs go through the sync service
      // rather than straight to the importer.
      if (job.data.syncScheduleId) {
        return { syncs: [await syncService.runSchedule(job.data.syncScheduleId)] };
      }
      if (job.name === 'external-sync') {
        return { syncs: await syncService.runDue() };
      }

      const providers =
        !job.data.providerKey || job.data.providerKey === 'all'
          ? availableProviders()
          : [createProvider(job.data.providerKey)];

      const results = [];
      for (const provider of providers) {
        if (!provider.isConfigured()) continue;

        const summary = await importService.run(provider, {
          ...(job.data.competitionExternalId
            ? { competitionExternalId: job.data.competitionExternalId }
            : {}),
          ...(job.data.seasonExternalId ? { seasonExternalId: job.data.seasonExternalId } : {}),
          ...(job.data.matchLimit ? { matchLimit: job.data.matchLimit } : {}),
          ...(job.data.since ? { since: new Date(job.data.since) } : {}),
          ...(job.data.requestedById ? { requestedById: job.data.requestedById } : {}),
          ...(job.data.demo !== undefined ? { demo: job.data.demo } : {}),
          includeEvents: job.data.includeEvents ?? true,
          includeTracking: job.data.includeTracking ?? false,
          jobId: job.id ?? undefined,
          onProgress: (message, progress) => {
            void job.updateProgress(progress);
            void job.log(message);
          },
        });

        results.push(summary);
        await audit({
          actorId: job.data.requestedById ?? null,
          action: 'import.complete',
          entityType: 'provider',
          entityId: provider.key,
          summary: `Imported ${summary.matches} matches and ${summary.events} events from ${provider.name}`,
          details: summary as unknown as Record<string, unknown>,
        });
      }

      return { imports: results };
    },
    { connection: connection(), ...common },
  );

  const analyticsWorker = new Worker<AnalyticsJobData>(
    QUEUE_ANALYTICS,
    async (job) => {
      if (job.data.refreshMaterializedViews) {
        const views = await analyticsService.refreshMaterializedViews();
        return { refreshed: views };
      }

      const seasons = job.data.competitionSeasonId
        ? [{ id: job.data.competitionSeasonId }]
        : await analyticsService.knownSeasons();

      const summaries = [];
      for (const [index, season] of seasons.entries()) {
        summaries.push(
          await analyticsService.recomputeSeason(season.id, (message, progress) => {
            const overall = (index / seasons.length) * 100 + progress / seasons.length;
            void job.updateProgress(Math.round(overall));
            void job.log(message);
          }),
        );
      }

      // Percentile and similarity views depend on what just changed.
      await analyticsService.refreshMaterializedViews();

      await audit({
        action: 'analytics.refresh',
        summary: `Recomputed analytics for ${summaries.length} season(s)`,
        details: { seasons: summaries.length },
      });

      return { seasons: summaries };
    },
    { connection: connection(), ...common },
  );

  const exportWorker = new Worker<ExportJobData>(
    QUEUE_EXPORT,
    async (job) => {
      const result = await exportService.run({
        ...(job.data.dataset ? { dataset: job.data.dataset } : {}),
        ...(job.data.sql ? { sql: job.data.sql } : {}),
        ...(job.data.name ? { name: job.data.name } : {}),
        format: job.data.format,
      });

      await audit({
        actorId: job.data.requestedById ?? null,
        action: 'export.create',
        entityType: 'export',
        entityId: result.key,
        summary: `Exported ${result.rowCount} rows to ${result.key}`,
        details: { bytes: result.bytes, format: result.format },
      });

      return result;
    },
    { connection: connection(), ...common },
  );

  const reportWorker = new Worker<ReportJobData>(
    QUEUE_REPORT,
    async (job) => {
      if (!job.data.playerId) throw new Error('Only player reports are supported');

      const result = await reportService.generatePlayerReport({
        playerId: job.data.playerId,
        ...(job.data.competitionSeasonId
          ? { competitionSeasonId: job.data.competitionSeasonId }
          : {}),
        ...(job.data.title ? { title: job.data.title } : {}),
        ...(job.data.summary ? { summary: job.data.summary } : {}),
        ...(job.data.recommendation ? { recommendation: job.data.recommendation } : {}),
        ...(job.data.authorId ? { authorId: job.data.authorId } : {}),
        includePdf: job.data.includePdf ?? true,
      });

      await audit({
        actorId: job.data.authorId ?? null,
        action: 'report.generate',
        entityType: 'report',
        entityId: result.reportId,
        summary: `Generated report ${result.reportId}`,
        details: { snapshot: result.dataSnapshotId, pdf: Boolean(result.pdfPath) },
      });

      return result;
    },
    { connection: connection(), concurrency: 1, prefix: QUEUE_PREFIX },
  );

  const maintenanceWorker = new Worker<MaintenanceJobData>(
    QUEUE_MAINTENANCE,
    async (job) => {
      switch (job.data.task) {
        case 'backup':
          return runBackup();
        case 'refresh-views':
          return { refreshed: await analyticsService.refreshMaterializedViews() };
        case 'cleanup':
          return cleanup();
        default:
          throw new Error(`Unknown maintenance task: ${String(job.data.task)}`);
      }
    },
    { connection: connection(), concurrency: 1, prefix: QUEUE_PREFIX },
  );

  const workers = [
    importWorker,
    analyticsWorker,
    exportWorker,
    reportWorker,
    maintenanceWorker,
  ];

  for (const worker of workers) {
    worker.on('failed', (job: Job | undefined, error: Error) => {
      logger.error({ queue: worker.name, jobId: job?.id, err: error.message }, 'job failed');
    });
    worker.on('completed', (job: Job) => {
      logger.info({ queue: worker.name, jobId: job.id }, 'job completed');
    });
  }

  return workers;
}

/** Runs the same backup script an operator would run by hand (§19, §68). */
async function runBackup(): Promise<{ output: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['scripts/db-backup.sh', '--label', 'scheduled'], {
      cwd: process.cwd(),
      env: process.env,
    });

    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        void audit({ action: 'backup.run', summary: 'Scheduled database backup completed' });
        resolve({ output: output.trim(), code: 0 });
      } else {
        reject(new Error(`Backup failed with exit code ${code}: ${output.trim()}`));
      }
    });
  });
}

/** Prune history that no longer earns its storage. */
async function cleanup(): Promise<{ auditLogs: number; queryHistory: number }> {
  const { prisma } = await import('@/db/client');
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  const [auditLogs, queryHistory] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.queryHistory.deleteMany({ where: { createdAt: { lt: cutoff } } }),
  ]);

  return { auditLogs: auditLogs.count, queryHistory: queryHistory.count };
}
