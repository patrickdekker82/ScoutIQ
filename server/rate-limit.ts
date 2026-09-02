import { getConfig } from '@/lib/config';
import { getRedis } from '@/lib/redis';

/**
 * Rate limiting (§62).
 *
 * A fixed window counter in Redis. Deliberately fail-open: if Redis is down,
 * ScoutIQ keeps serving rather than locking every user out of a self-hosted
 * install over a cache outage.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function rateLimit(
  key: string,
  options: { max?: number; windowSeconds?: number } = {},
): Promise<RateLimitResult> {
  const { rateLimit: config } = getConfig().auth;
  const max = options.max ?? config.maxRequests;
  const windowSeconds = options.windowSeconds ?? config.windowSeconds;

  try {
    const redis = getRedis();
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const redisKey = `scoutiq:ratelimit:${key}:${window}`;

    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds);

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetSeconds: windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds),
    };
  } catch {
    return { allowed: true, remaining: max, resetSeconds: windowSeconds };
  }
}

export const loginRateLimit = (identifier: string): Promise<RateLimitResult> =>
  rateLimit(`login:${identifier}`, {
    max: getConfig().auth.rateLimit.loginMax,
    windowSeconds: 300,
  });
