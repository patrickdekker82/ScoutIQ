import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Executable version of the portability spec and the "never" list of §92.
 *
 * These tests fail the build if someone reintroduces a Windows path, a fixed
 * IP, a NAS-specific location, or a stray `process.env` read - the things that
 * would tie ScoutIQ to one machine or hide a configuration decision.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  'data',
  '__pycache__',
  '.venv',
]);

async function walk(dir: string, extensions: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full, extensions)));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

const relative = (file: string): string => path.relative(REPO_ROOT, file);

/** Source directories that must stay host-agnostic. */
const SOURCE_DIRS = [
  'analytics',
  'app',
  'components',
  'db',
  'jobs',
  'lib',
  'providers',
  'reports',
  'server',
  'scripts',
];

async function sourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const dir of SOURCE_DIRS) {
    files.push(...(await walk(path.join(REPO_ROOT, dir), ['.ts', '.tsx'])));
  }
  files.push(...(await walk(path.join(REPO_ROOT, 'analytics-worker'), ['.py'])));
  return files;
}

describe('no host-specific assumptions in source', () => {
  const forbidden: { name: string; pattern: RegExp }[] = [
    { name: 'Windows drive path', pattern: /(?<![\w:])[A-Z]:\\\\?[\w\\]/ },
    { name: 'UNC / NAS share path', pattern: /\\\\\\\\[\w.-]+\\/ },
    { name: 'Synology volume path', pattern: /\/volume[1-9]\// },
    {
      name: 'hard-coded LAN IP',
      pattern: /\b(?:192\.168|10\.\d{1,3}\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\b/,
    },
    { name: 'Windows user directory', pattern: /C:\\Users/i },
  ];

  it('contains no Windows paths, UNC shares, NAS paths or fixed LAN IPs', async () => {
    const violations: string[] = [];

    for (const file of await sourceFiles()) {
      const contents = await readFile(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.pattern.test(contents)) violations.push(`${relative(file)}: ${rule.name}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('reads process.env only where configuration is defined', async () => {
    // lib/config.ts owns the environment contract. The exceptions each read a
    // variable that belongs to the process, not to the application's config.
    const allowed = new Set([
      path.join('lib', 'config.ts'),
      path.join('scripts', 'seed.ts'), // SEED_* inputs for a one-off command
      path.join('jobs', 'workers.ts'), // passes the environment to a child process
      path.join('tests', 'setup.ts'),
    ]);

    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const rel = relative(file);
      if (allowed.has(rel)) continue;

      const contents = await readFile(file, 'utf8');
      const matches = contents.match(/process\.env(?:\.(?!npm_package_version)\w+|\[)/g);
      if (matches) offenders.push(`${rel}: ${matches.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the live database off the NAS by default (§18, §92)', async () => {
    const compose = await readFile(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    // PostgreSQL data lives in a Docker named volume on the VM's own disk,
    // never in a bind mount pointing at a NAS path.
    expect(compose).toMatch(/^\s*- \w+:\/var\/lib\/postgresql\/data$/m);
    expect(compose).not.toMatch(/(NAS_[A-Z_]*PATH|ARCHIVE_ROOT)[^\n]*:\/var\/lib\/postgresql/);
  });

  it('stores no absolute paths in the database schema', async () => {
    const schema = await readFile(path.join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toContain('env("DATABASE_URL")');
    expect(schema).not.toMatch(/url\s*=\s*"postgres/);
  });
});

describe('required artefacts exist', () => {
  const required = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.dev.yml',
    'docker-compose.prod.yml',
    '.env.example',
    'scripts/db-backup.sh',
    'scripts/db-restore.sh',
    'scripts/db-verify.sh',
    'prisma/schema.prisma',
    'prisma/migrations/20260101000000_init/migration.sql',
    'prisma/migrations/20260101000100_sql_objects/migration.sql',
    // §90 deployment documentation
    'docs/deployment/windows11-hyperv.md',
    'docs/deployment/hyperv.md',
    'docs/deployment/debian-vm.md',
    'docs/deployment/docker.md',
    'docs/deployment/nas.md',
    'docs/deployment/backups.md',
    'docs/deployment/remote-access.md',
    'docs/deployment/migrate-home-to-vps.md',
    'docs/deployment/production-vps.md',
    'docs/deployment/rollback.md',
    // §24, §76, §77
    'docs/sql/README.md',
    'docs/database/erd.md',
  ];

  it.each(required)('%s is present and non-empty', async (file) => {
    const info = await stat(path.join(REPO_ROOT, file));
    expect(info.isFile()).toBe(true);
    expect(info.size).toBeGreaterThan(0);
  });

  it('exposes the documented commands through npm (§9, §14-16, §22, §68)', async () => {
    const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    for (const script of [
      'db:backup',
      'db:restore',
      'db:verify',
      'db:export',
      'db:migrate',
      'db:seed',
      'ingest:statsbomb',
      'ingest:skillcorner',
      'ingest:metrica',
      'analytics:refresh',
    ]) {
      expect(pkg.scripts[script]).toBeTruthy();
    }
  });

  it('documents every storage root and provider flag in .env.example (§74)', async () => {
    const example = await readFile(path.join(REPO_ROOT, '.env.example'), 'utf8');

    for (const key of [
      'DATABASE_URL',
      'DIRECT_DATABASE_URL',
      'REDIS_URL',
      'DATA_ROOT',
      'EXPORT_ROOT',
      'REPORT_ROOT',
      'BACKUP_ROOT',
      'NAS_BACKUP_PATH',
      'NAS_DATASET_PATH',
      'NAS_REPORT_PATH',
      'ENABLE_STATSBOMB_OPEN_DATA',
      'ENABLE_SKILLCORNER_OPEN_DATA',
      'ENABLE_METRICA_OPEN_DATA',
      'SPORTMONKS_API_KEY',
      'API_FOOTBALL_KEY',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'POSTGRES_DB',
    ]) {
      expect(example, `${key} missing from .env.example`).toContain(`${key}=`);
    }
  });

  it('never commits a real .env', async () => {
    const gitignore = await readFile(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
  });
});

describe('SQL objects the analyst layer promises (§21, §22)', () => {
  it('creates every documented view and materialized view', async () => {
    const sql = await readFile(
      path.join(REPO_ROOT, 'prisma/migrations/20260101000100_sql_objects/migration.sql'),
      'utf8',
    );

    for (const view of [
      'vw_player_match_stats',
      'vw_player_season_stats',
      'vw_player_per90',
      'vw_player_percentiles',
      'vw_team_match_stats',
      'vw_team_season_stats',
      'vw_match_summary',
      'vw_player_roles',
      'vw_player_similarity',
      'vw_team_style_profiles',
      'vw_player_club_fit',
      'vw_heatmap_zone_activity',
    ]) {
      expect(sql, `${view} missing`).toContain(`CREATE OR REPLACE VIEW ${view}`);
    }

    for (const view of [
      'mv_player_season_metrics',
      'mv_player_percentiles',
      'mv_team_style_profiles',
      'mv_player_similarity',
      'mv_heatmap_zone_stats',
    ]) {
      expect(sql, `${view} missing`).toContain(`CREATE MATERIALIZED VIEW ${view}`);
    }
  });
});
