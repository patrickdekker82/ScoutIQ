import { Worker } from 'bullmq';
import { getConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createRedis } from '../lib/redis.js';
import { buildProviders } from '../providers/index.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { ImportService } from '../services/import.service.js';
import {
  QUEUE_ANALYTICS,
  QUEUE_IMPORT,
  QUEUE_PREFIX,
  type AnalyticsJobData,
  type ImportJobData,
} from '../queue/queues.js';

/**
 * Worker processes.
 *
 * Started by `npm run start:worker` in their own container. Scale them by
 * running more replicas - nothing in a worker assumes it is the only one, and
 * nothing assumes it shares a filesystem with the API beyond the configured
 * storage roots.
 */
export function startWorkers(): Worker[] {
  const { scheduler } = getConfig();
  const importService = new ImportService();
  const analyticsService = new AnalyticsService();

  const importWorker = new Worker<ImportJobData>(
    QUEUE_IMPORT,
    async (job) => {
      const providers = buildProviders().filter(
        (provider) => !job.data.providerKey || provider.key === job.data.providerKey,
      );

      if (providers.length === 0) {
        logger.warn({ requested: job.data.providerKey }, 'no matching providers enabled');
        return { runs: 0 };
      }

      const since = job.data.since ? new Date(job.data.since) : undefined;
      let runs = 0;
      for (const provider of providers) {
        await importService.run(provider, since ? { since } : {});
        runs += 1;
      }
      return { runs };
    },
    { connection: createRedis(), prefix: QUEUE_PREFIX, concurrency: scheduler.concurrency },
  );

  const analyticsWorker = new Worker<AnalyticsJobData>(
    QUEUE_ANALYTICS,
    async (job) => {
      const seasons = job.data.season
        ? [job.data.season]
        : await analyticsService.knownSeasons();

      let players = 0;
      for (const season of seasons) {
        players += await analyticsService.recomputeSeason(season);
      }
      return { seasons: seasons.length, players };
    },
    { connection: createRedis(), prefix: QUEUE_PREFIX, concurrency: scheduler.concurrency },
  );

  for (const worker of [importWorker, analyticsWorker]) {
    worker.on('failed', (job, error) => {
      logger.error({ queue: worker.name, jobId: job?.id, err: error.message }, 'job failed');
    });
    worker.on('completed', (job) => {
      logger.info({ queue: worker.name, jobId: job.id }, 'job completed');
    });
  }

  return [importWorker, analyticsWorker];
}
