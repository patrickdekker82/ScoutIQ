import { z } from 'zod';

/**
 * Environment contract for ScoutIQ.
 *
 * Everything that differs between a Hyper-V VM, a bare-metal server and a VPS
 * is resolved here and nowhere else. No module outside this file may read
 * `process.env` directly, and no module may contain an absolute host path.
 */

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const port = z.coerce.number().int().min(1).max(65535);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  HTTP_PORT: port.default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  ANALYTICS_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  DATA_ROOT: z.string().min(1).default('/data'),
  RAW_DATA_ROOT: z.string().min(1).optional(),
  EXPORT_ROOT: z.string().min(1).optional(),
  REPORT_ROOT: z.string().min(1).optional(),
  BACKUP_ROOT: z.string().min(1).optional(),
  ARCHIVE_ROOT: z.string().min(1).optional(),

  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),

  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  CORS_ORIGINS: z.string().default('*'),

  SCHEDULER_ENABLED: booleanish.default(true),
  IMPORT_CRON: z.string().min(1).default('0 3 * * *'),
  ANALYTICS_CRON: z.string().min(1).default('30 3 * * *'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(4),

  ENABLED_PROVIDERS: z.string().default('local-file'),
  HTTP_JSON_PROVIDER_BASE_URL: z.string().url().optional(),
  HTTP_JSON_PROVIDER_API_KEY: z.string().optional(),
  INGEST_SERVICE_URL: z.string().url().optional(),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface StorageConfig {
  /** Root under which every other data path lives by default. */
  root: string;
  raw: string;
  exports: string;
  reports: string;
  backups: string;
  /** Optional secondary target (NAS, object-storage mount). Never required. */
  archive: string | null;
}

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  logLevel: RawEnv['LOG_LEVEL'];
  http: { host: string; port: number; publicBaseUrl: string; corsOrigins: string[] | true };
  database: { url: string; analyticsUrl: string };
  redis: { url: string };
  storage: StorageConfig;
  backup: { retentionDays: number };
  auth: { secret: string; tokenTtlSeconds: number };
  scheduler: { enabled: boolean; importCron: string; analyticsCron: string; concurrency: number };
  providers: {
    enabled: string[];
    httpJson: { baseUrl: string | undefined; apiKey: string | undefined };
    ingestServiceUrl: string | undefined;
  };
}

/**
 * Join a configurable root with a child segment using POSIX semantics.
 *
 * Deliberately not `node:path.join`: container paths are always POSIX, and the
 * result must be identical whether the build happens on Windows or Linux.
 */
export const joinRoot = (root: string, child: string): string =>
  `${root.replace(/\/+$/, '')}/${child.replace(/^\/+/, '')}`;

export function buildConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}\n\nSee .env.example.`);
  }

  const env = parsed.data;
  const root = env.DATA_ROOT.replace(/\/+$/, '') || '/';

  const corsOrigins = env.CORS_ORIGINS.trim() === '*' ? true : csv(env.CORS_ORIGINS);

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL,
    http: {
      host: env.HTTP_HOST,
      port: env.HTTP_PORT,
      publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
      corsOrigins,
    },
    database: {
      url: env.DATABASE_URL,
      analyticsUrl: env.ANALYTICS_DATABASE_URL ?? env.DATABASE_URL,
    },
    redis: { url: env.REDIS_URL },
    storage: {
      root,
      raw: env.RAW_DATA_ROOT ?? joinRoot(root, 'raw'),
      exports: env.EXPORT_ROOT ?? joinRoot(root, 'exports'),
      reports: env.REPORT_ROOT ?? joinRoot(root, 'reports'),
      backups: env.BACKUP_ROOT ?? joinRoot(root, 'backups'),
      archive: env.ARCHIVE_ROOT ?? null,
    },
    backup: { retentionDays: env.BACKUP_RETENTION_DAYS },
    auth: { secret: env.AUTH_SECRET, tokenTtlSeconds: env.AUTH_TOKEN_TTL_SECONDS },
    scheduler: {
      enabled: env.SCHEDULER_ENABLED,
      importCron: env.IMPORT_CRON,
      analyticsCron: env.ANALYTICS_CRON,
      concurrency: env.WORKER_CONCURRENCY,
    },
    providers: {
      enabled: csv(env.ENABLED_PROVIDERS),
      httpJson: {
        baseUrl: env.HTTP_JSON_PROVIDER_BASE_URL,
        apiKey: env.HTTP_JSON_PROVIDER_API_KEY,
      },
      ingestServiceUrl: env.INGEST_SERVICE_URL,
    },
  };
}

let cached: AppConfig | undefined;

/** Lazily built singleton so importing a module never throws on a bad env. */
export function getConfig(): AppConfig {
  cached ??= buildConfig();
  return cached;
}

/** Test helper: forget the memoised config. */
export function resetConfig(): void {
  cached = undefined;
}
