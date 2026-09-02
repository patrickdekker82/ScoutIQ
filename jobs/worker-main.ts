import { logger } from '@/lib/logger';
import { disconnectPrisma } from '@/db/client';
import { disconnectRedis } from '@/lib/redis';
import { getStorage } from '@/lib/storage';
import { closeQueues } from '@/jobs/queues';
import { startWorkers } from '@/jobs/workers';

/** Worker entrypoint: `npm run worker` / the scoutiq-worker container. */
async function main(): Promise<void> {
  const roots = await getStorage().ensureAllAreas();
  logger.info({ roots }, 'storage ready');

  const workers = startWorkers();
  logger.info({ queues: workers.map((worker) => worker.name) }, 'workers started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down workers');
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await closeQueues();
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'worker crashed');
  process.exit(1);
});
