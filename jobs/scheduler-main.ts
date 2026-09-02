import { logger } from '@/lib/logger';
import { disconnectRedis } from '@/lib/redis';
import { closeQueues } from '@/jobs/queues';
import { registerSchedules } from '@/jobs/scheduler';

/**
 * Scheduler entrypoint: `npm run scheduler` / the scoutiq-scheduler container.
 *
 * A separate process from the workers so schedules are registered exactly once
 * however many worker replicas are running.
 */
async function main(): Promise<void> {
  const registered = await registerSchedules();
  logger.info({ registered }, 'scheduler ready');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down scheduler');
    await closeQueues();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep the process alive: BullMQ's scheduler lives in Redis, this process
  // only owns the registration and the health of the connection.
  setInterval(() => undefined, 1 << 30);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'scheduler crashed');
  process.exit(1);
});
