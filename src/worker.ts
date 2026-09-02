import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { closeQueues } from './queue/queues.js';
import { registerSchedules } from './queue/scheduler.js';
import { getStorage } from './lib/storage.js';
import { startWorkers } from './workers/index.js';

/** Worker entrypoint: `npm run start:worker` / the `worker` compose service. */
async function main(): Promise<void> {
  await getStorage().ensureAllAreas();
  await registerSchedules();

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

main().catch((error) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'worker crashed');
  process.exit(1);
});
