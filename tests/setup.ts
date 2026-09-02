/**
 * Baseline environment for tests.
 *
 * Individual tests override these; the baseline exists so that importing a
 * module never fails merely because the process has no configuration.
 *
 * Written through an index signature: Next.js types NODE_ENV as read-only.
 */
const env = process.env as Record<string, string | undefined>;

env.NODE_ENV = 'test';
env.DATABASE_URL ??= 'postgresql://scoutiq:scoutiq@localhost:5432/scoutiq_test';
env.REDIS_URL ??= 'redis://localhost:6379';
env.AUTH_SECRET ??= 'test-secret-value-that-is-long-enough';
env.LOG_LEVEL ??= 'silent';
