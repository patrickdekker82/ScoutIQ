import type { FastifyInstance } from 'fastify';
import { getConfig } from '../../config/env.js';
import { getPrisma } from '../../lib/prisma.js';
import { getRedis } from '../../lib/redis.js';
import { getStorage } from '../../lib/storage.js';

/**
 * Health endpoints.
 *
 * `/health/live`  - the process is up (used as the container health check).
 * `/health/ready` - dependencies are reachable. Storage archive is reported
 *                   but never fails the check: the NAS is optional.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/health/ready', async (_request, reply) => {
    const storage = getStorage();
    const checks: Record<string, string> = {};

    try {
      await getPrisma().$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch (error) {
      checks.database = error instanceof Error ? error.message : 'unreachable';
    }

    try {
      checks.redis = (await getRedis().ping()) === 'PONG' ? 'ok' : 'unexpected reply';
    } catch (error) {
      checks.redis = error instanceof Error ? error.message : 'unreachable';
    }

    try {
      await storage.ensureAllAreas();
      checks.storage = 'ok';
    } catch (error) {
      checks.storage = error instanceof Error ? error.message : 'unwritable';
    }

    checks.archive = storage.archiveConfigured
      ? (await storage.archiveAvailable())
        ? 'ok'
        : 'unavailable (optional)'
      : 'not configured (optional)';

    const required = [checks.database, checks.redis, checks.storage];
    const healthy = required.every((value) => value === 'ok');

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      checks,
      // Roots are echoed so an operator can confirm the mounts a container
      // actually received, without shelling into it.
      storageRoots: getConfig().storage,
    });
  });
}
