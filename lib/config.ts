import { z } from 'zod';

/**
 * Environment contract for ScoutIQ.
 *
 * This is the ONLY module that reads `process.env`. Everything that differs
 * between the Hyper-V VM, a bare-metal server and a VPS is resolved here, so
 * the same image runs everywhere with a different `.env` and nothing else.
 *
 * Enforced by tests/portability.test.ts.
 */

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const port = z.coerce.number().int().min(1).max(65535);
const optionalUrl = z.string().url().optional().or(z.literal('').transform(() => undefined));
const optionalText = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  HTTP_HOST: z.string().min(1).default('0.0.0.0'),
  PORT: port.default(3000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  // --- database ---------------------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /// Direct (non-pooled) connection used by migrations, exports, backups and
  /// the SQL console. Falls back to DATABASE_URL.
  DIRECT_DATABASE_URL: optionalText,
  ANALYTICS_DATABASE_URL: optionalText,

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // --- storage roots (§17) ---------------------------------------------
  DATA_ROOT: z.string().min(1).default('/data'),
  RAW_DATA_ROOT: optionalText,
  NORMALIZED_DATA_ROOT: optionalText,
  PROCESSED_DATA_ROOT: optionalText,
  EXPORT_ROOT: optionalText,
  REPORT_ROOT: optionalText,
  BACKUP_ROOT: optionalText,

  // --- NAS (§18) - optional infrastructure, never required --------------
  NAS_BACKUP_PATH: optionalText,
  NAS_DATASET_PATH: optionalText,
  NAS_REPORT_PATH: optionalText,
  ARCHIVE_ROOT: optionalText,

  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).default(14),

  // --- security (§62) ---------------------------------------------------
  AUTH_SECRET: optionalText,
  /// Accepted alias so the documented NEXTAUTH_SECRET keeps working.
  NEXTAUTH_SECRET: optionalText,
  AUTH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  CORS_ORIGINS: z.string().default(''),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  // --- scheduling (§58) -------------------------------------------------
  SCHEDULER_ENABLED: booleanish.default(true),
  PROVIDER_SYNC_CRON: z.string().min(1).default('0 3 * * *'),
  ANALYTICS_CRON: z.string().min(1).default('30 3 * * *'),
  MATERIALIZED_VIEW_CRON: z.string().min(1).default('0 4 * * *'),
  BACKUP_CRON: z.string().min(1).default('0 2 * * *'),
  CLEANUP_CRON: z.string().min(1).default('0 5 * * 0'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(64).default(2),

  // --- providers (§12, §13, §61) ---------------------------------------
  ENABLE_STATSBOMB_OPEN_DATA: booleanish.default(true),
  ENABLE_SKILLCORNER_OPEN_DATA: booleanish.default(true),
  ENABLE_METRICA_OPEN_DATA: booleanish.default(true),
  ENABLE_DEMO_PROVIDER: booleanish.default(true),
  STATSBOMB_DATA_URL: z
    .string()
    .url()
    .default('https://raw.githubusercontent.com/statsbomb/open-data/master/data'),
  SKILLCORNER_DATA_URL: z
    .string()
    .url()
    .default('https://raw.githubusercontent.com/SkillCorner/opendata/master/data'),
  METRICA_DATA_URL: z
    .string()
    .url()
    .default('https://raw.githubusercontent.com/metrica-sports/sample-data/master/data'),
  /// Local directories may be used instead of the network, e.g. a NAS copy.
  STATSBOMB_LOCAL_PATH: optionalText,
  SKILLCORNER_LOCAL_PATH: optionalText,
  METRICA_LOCAL_PATH: optionalText,

  SPORTMONKS_API_KEY: optionalText,
  SPORTMONKS_BASE_URL: z.string().url().default('https://api.sportmonks.com/v3/football'),
  API_FOOTBALL_KEY: optionalText,
  API_FOOTBALL_BASE_URL: z.string().url().default('https://v3.football.api-sports.io'),
  THESTATSAPI_KEY: optionalText,
  THESTATSAPI_BASE_URL: optionalUrl,

  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  PROVIDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),

  // --- analytics --------------------------------------------------------
  ANALYTICS_MIN_MINUTES: z.coerce.number().int().min(0).default(450),
  ANALYTICS_WORKER_URL: optionalUrl,
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),

  // --- reports (§51) ----------------------------------------------------
  PDF_ENABLED: booleanish.default(true),
  PDF_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /// Use an existing Chromium/Chrome instead of Playwright's bundled browser.
  PDF_BROWSER_EXECUTABLE: optionalText,
  REPORT_LOGO_PATH: optionalText,
  REPORT_ORGANISATION: z.string().default('ScoutIQ'),

  // --- SQL console (§23) ------------------------------------------------
  SQL_CONSOLE_ENABLED: booleanish.default(true),
  SQL_CONSOLE_MAX_ROWS: z.coerce.number().int().positive().max(100_000).default(1000),
  SQL_CONSOLE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  DEMO_MODE: booleanish.default(true),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface StorageConfig {
  root: string;
  raw: string;
  normalized: string;
  processed: string;
  exports: string;
  reports: string;
  backups: string;
  /// Optional secondary targets (NAS, object storage). Never required.
  archive: string | null;
  nasBackup: string | null;
  nasDataset: string | null;
  nasReport: string | null;
}

export interface ProviderCredentials {
  sportmonksApiKey?: string | undefined;
  apiFootballKey?: string | undefined;
  theStatsApiKey?: string | undefined;
}

export interface AppConfig {
  env: RawEnv['NODE_ENV'];
  isProduction: boolean;
  isTest: boolean;
  logLevel: RawEnv['LOG_LEVEL'];
  demoMode: boolean;
  http: { host: string; port: number; publicBaseUrl: string; corsOrigins: string[] };
  database: { url: string; directUrl: string; analyticsUrl: string };
  redis: { url: string };
  storage: StorageConfig;
  backup: { retentionDays: number };
  auth: {
    secret: string;
    tokenTtlSeconds: number;
    rateLimit: { windowSeconds: number; maxRequests: number; loginMax: number };
  };
  scheduler: {
    enabled: boolean;
    providerSyncCron: string;
    analyticsCron: string;
    materializedViewCron: string;
    backupCron: string;
    cleanupCron: string;
    concurrency: number;
  };
  providers: {
    statsbomb: { enabled: boolean; baseUrl: string; localPath: string | undefined };
    skillcorner: { enabled: boolean; baseUrl: string; localPath: string | undefined };
    metrica: { enabled: boolean; baseUrl: string; localPath: string | undefined };
    demo: { enabled: boolean };
    sportmonks: { baseUrl: string; apiKey: string | undefined };
    apiFootball: { baseUrl: string; apiKey: string | undefined };
    theStatsApi: { baseUrl: string | undefined; apiKey: string | undefined };
    timeoutMs: number;
    maxRetries: number;
    rateLimitPerMinute: number;
  };
  analytics: { minMinutes: number; workerUrl: string | undefined; cacheTtlSeconds: number };
  reports: {
    pdfEnabled: boolean;
    pdfTimeoutMs: number;
    browserExecutable: string | undefined;
    logoPath: string | undefined;
    organisation: string;
  };
  sqlConsole: { enabled: boolean; maxRows: number; timeoutMs: number };
}

/**
 * Join a configurable root with a child segment using POSIX semantics.
 *
 * Deliberately not `node:path.join`: container paths are always POSIX and the
 * result must not depend on whether the build ran on Windows or Linux.
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

  const secret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  - AUTH_SECRET (or NEXTAUTH_SECRET) must be set and at least 16 characters.\n' +
        '    Generate one with: openssl rand -hex 32',
    );
  }

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    logLevel: env.LOG_LEVEL,
    demoMode: env.DEMO_MODE,
    http: {
      host: env.HTTP_HOST,
      port: env.PORT,
      publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
      corsOrigins: csv(env.CORS_ORIGINS),
    },
    database: {
      url: env.DATABASE_URL,
      directUrl: env.DIRECT_DATABASE_URL ?? env.DATABASE_URL,
      analyticsUrl: env.ANALYTICS_DATABASE_URL ?? env.DATABASE_URL,
    },
    redis: { url: env.REDIS_URL },
    storage: {
      root,
      raw: env.RAW_DATA_ROOT ?? joinRoot(root, 'raw'),
      normalized: env.NORMALIZED_DATA_ROOT ?? joinRoot(root, 'normalized'),
      processed: env.PROCESSED_DATA_ROOT ?? joinRoot(root, 'processed'),
      exports: env.EXPORT_ROOT ?? joinRoot(root, 'exports'),
      reports: env.REPORT_ROOT ?? joinRoot(root, 'reports'),
      backups: env.BACKUP_ROOT ?? joinRoot(root, 'backups'),
      archive: env.ARCHIVE_ROOT ?? null,
      nasBackup: env.NAS_BACKUP_PATH ?? null,
      nasDataset: env.NAS_DATASET_PATH ?? null,
      nasReport: env.NAS_REPORT_PATH ?? null,
    },
    backup: { retentionDays: env.BACKUP_RETENTION_DAYS },
    auth: {
      secret,
      tokenTtlSeconds: env.AUTH_TOKEN_TTL_SECONDS,
      rateLimit: {
        windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
        maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
        loginMax: env.LOGIN_RATE_LIMIT_MAX,
      },
    },
    scheduler: {
      enabled: env.SCHEDULER_ENABLED,
      providerSyncCron: env.PROVIDER_SYNC_CRON,
      analyticsCron: env.ANALYTICS_CRON,
      materializedViewCron: env.MATERIALIZED_VIEW_CRON,
      backupCron: env.BACKUP_CRON,
      cleanupCron: env.CLEANUP_CRON,
      concurrency: env.WORKER_CONCURRENCY,
    },
    providers: {
      statsbomb: {
        enabled: env.ENABLE_STATSBOMB_OPEN_DATA,
        baseUrl: env.STATSBOMB_DATA_URL,
        localPath: env.STATSBOMB_LOCAL_PATH,
      },
      skillcorner: {
        enabled: env.ENABLE_SKILLCORNER_OPEN_DATA,
        baseUrl: env.SKILLCORNER_DATA_URL,
        localPath: env.SKILLCORNER_LOCAL_PATH,
      },
      metrica: {
        enabled: env.ENABLE_METRICA_OPEN_DATA,
        baseUrl: env.METRICA_DATA_URL,
        localPath: env.METRICA_LOCAL_PATH,
      },
      demo: { enabled: env.ENABLE_DEMO_PROVIDER },
      sportmonks: { baseUrl: env.SPORTMONKS_BASE_URL, apiKey: env.SPORTMONKS_API_KEY },
      apiFootball: { baseUrl: env.API_FOOTBALL_BASE_URL, apiKey: env.API_FOOTBALL_KEY },
      theStatsApi: { baseUrl: env.THESTATSAPI_BASE_URL, apiKey: env.THESTATSAPI_KEY },
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      maxRetries: env.PROVIDER_MAX_RETRIES,
      rateLimitPerMinute: env.PROVIDER_RATE_LIMIT_PER_MINUTE,
    },
    analytics: {
      minMinutes: env.ANALYTICS_MIN_MINUTES,
      workerUrl: env.ANALYTICS_WORKER_URL,
      cacheTtlSeconds: env.CACHE_TTL_SECONDS,
    },
    reports: {
      pdfEnabled: env.PDF_ENABLED,
      pdfTimeoutMs: env.PDF_TIMEOUT_MS,
      browserExecutable: env.PDF_BROWSER_EXECUTABLE,
      logoPath: env.REPORT_LOGO_PATH,
      organisation: env.REPORT_ORGANISATION,
    },
    sqlConsole: {
      enabled: env.SQL_CONSOLE_ENABLED,
      maxRows: env.SQL_CONSOLE_MAX_ROWS,
      timeoutMs: env.SQL_CONSOLE_TIMEOUT_MS,
    },
  };
}

let cached: AppConfig | undefined;

/** Lazily built singleton so importing a module never throws on a bad env. */
export function getConfig(): AppConfig {
  cached ??= buildConfig();
  return cached;
}

export function resetConfig(): void {
  cached = undefined;
}
