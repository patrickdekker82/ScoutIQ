import { getConfig } from './config/env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma } from './lib/prisma.js';
import { disconnectRedis } from './lib/redis.js';
import { getStorage } from './lib/storage.js';
import { buildServer } from './http/server.js';
import { closeQueues } from './queue/queues.js';

/** API entrypoint: `npm start` / the `api` compose service. */
async function main(): Promise<void> {
  const config = getConfig();

  // Create the storage tree on whatever is mounted at DATA_ROOT. Failing here
  // is deliberate: a misconfigured mount must be visible at boot, not at the
  // first report write.
  const roots = await getStorage().ensureAllAreas();
  logger.info({ roots }, 'storage ready');

  const app = await buildServer();
  await app.listen({ host: config.http.host, port: config.http.port });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down api');
    await app.close();
    await closeQueues();
    await disconnectPrisma();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'api crashed');
  process.exit(1);
});
