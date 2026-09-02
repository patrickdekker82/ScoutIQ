import { Redis, type RedisOptions } from 'ioredis';
import { getConfig } from '../config/env.js';

/**
 * Redis connections are created per role (queue producer, worker, generic),
 * because BullMQ requires a dedicated blocking connection per worker. All of
 * them resolve the host from REDIS_URL, so Redis can be moved to its own
 * machine without touching application code.
 */
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
};

export function createRedis(options: RedisOptions = {}): Redis {
  const { url } = getConfig().redis;
  return new Redis(url, { ...baseOptions, ...options });
}

let shared: Redis | undefined;

export function getRedis(): Redis {
  shared ??= createRedis();
  return shared;
}

export async function disconnectRedis(): Promise<void> {
  await shared?.quit().catch(() => undefined);
  shared = undefined;
}
