import { Redis, type RedisOptions } from 'ioredis';
import { getConfig } from '@/lib/config';

/**
 * Redis connections, resolved from REDIS_URL so Redis can move to its own
 * machine without touching application code (§59, future scaling).
 *
 * BullMQ needs a dedicated blocking connection per worker, hence the factory
 * alongside the shared client.
 */
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

export function createRedis(options: RedisOptions = {}): Redis {
  return new Redis(getConfig().redis.url, { ...baseOptions, ...options });
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

/**
 * Cache helper (§61): analytics results are expensive, so frequently used
 * derivations are memoised in Redis. A Redis failure degrades to a direct
 * computation rather than an error - the cache is never load-bearing.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  if (ttlSeconds <= 0) return produce();

  try {
    const hit = await getRedis().get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return produce();
  }

  const value = await produce();
  try {
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Caching is best-effort.
  }
  return value;
}

export async function invalidateCache(pattern: string): Promise<number> {
  try {
    const redis = getRedis();
    const keys = await redis.keys(pattern);
    if (keys.length === 0) return 0;
    return await redis.del(...keys);
  } catch {
    return 0;
  }
}
