import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Executable version of PORTABILITY_AND_FUTURE_VPS_MIGRATION.md.
 *
 * These tests fail the build if someone reintroduces a Windows path, a fixed
 * IP, a NAS-specific location, or a direct `process.env` read outside the
 * config module - the exact things that would tie ScoutIQ to one machine.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'data',
  '__pycache__',
  '.venv',
]);

async function walk(dir: string, extensions: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
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

describe('no host-specific assumptions in source', () => {
  const forbidden: { name: string; pattern: RegExp }[] = [
    { name: 'Windows drive path', pattern: /(?<![\w:])[A-Z]:\\\\?[\w\\]/ },
    { name: 'UNC / NAS share path', pattern: /\\\\\\\\[\w.-]+\\/ },
    { name: 'Synology-specific path', pattern: /\/volume[1-9]\// },
    { name: 'hard-coded LAN IP', pattern: /\b(?:192\.168|10\.(?:\d{1,3})\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\b/ },
    { name: 'Windows user directory', pattern: /C:\\Users/i },
    { name: 'hard-coded /mnt or /volume root in code', pattern: /['"`]\/(?:mnt|volume\d)\/[\w./-]+['"`]/ },
  ];

  it('contains no Windows paths, UNC shares, NAS paths or fixed IPs', async () => {
    const files = await walk(path.join(REPO_ROOT, 'src'), ['.ts']);
    files.push(...(await walk(path.join(REPO_ROOT, 'services'), ['.py'])));

    const violations: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const rule of forbidden) {
        if (rule.pattern.test(contents)) {
          violations.push(`${relative(file)}: ${rule.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('reads process.env only inside the configuration modules', async () => {
    const files = await walk(path.join(REPO_ROOT, 'src'), ['.ts']);
    const allowed = new Set([path.join('src', 'config', 'env.ts')]);

    const offenders = [];
    for (const file of files) {
      const rel = relative(file);
      if (allowed.has(rel)) continue;
      const contents = await readFile(file, 'utf8');
      // `npm_package_version` is injected by npm, not an environment setting.
      const matches = contents.match(/process\.env\.(?!npm_package_version)\w+/g);
      if (matches) offenders.push(`${rel}: ${matches.join(', ')}`);
    }

    // The seed CLI is allowed to read its own SEED_* inputs.
    const unexpected = offenders.filter((entry) => !entry.startsWith(path.join('src', 'cli', 'seed.ts')));
    expect(unexpected).toEqual([]);
  });

  it('stores no absolute paths in the database schema', async () => {
    const schema = await readFile(path.join(REPO_ROOT, 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toContain('env("DATABASE_URL")');
    expect(schema).not.toMatch(/url\s*=\s*"postgres/);
  });
});

describe('required portability artefacts exist', () => {
  const required = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.dev.yml',
    'docker-compose.prod.yml',
    '.env.example',
    'scripts/db-backup.sh',
    'scripts/db-restore.sh',
    'scripts/db-verify.sh',
    'docs/deployment/windows11-hyperv.md',
    'docs/deployment/debian-vm.md',
    'docs/deployment/docker.md',
    'docs/deployment/nas.md',
    'docs/deployment/backup.md',
    'docs/deployment/migrate-home-to-vps.md',
    'docs/deployment/production-vps.md',
    'docs/deployment/rollback.md',
  ];

  it.each(required)('%s is present and non-empty', async (file) => {
    const info = await stat(path.join(REPO_ROOT, file));
    expect(info.isFile()).toBe(true);
    expect(info.size).toBeGreaterThan(0);
  });

  it('exposes the documented database scripts through npm', async () => {
    const pkg = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const script of ['db:backup', 'db:restore', 'db:verify', 'db:migrate']) {
      expect(pkg.scripts[script]).toBeTruthy();
    }
  });

  it('documents every storage root in .env.example', async () => {
    const example = await readFile(path.join(REPO_ROOT, '.env.example'), 'utf8');
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'DATA_ROOT',
      'RAW_DATA_ROOT',
      'EXPORT_ROOT',
      'REPORT_ROOT',
      'BACKUP_ROOT',
    ]) {
      expect(example).toContain(`${key}=`);
    }
  });

  it('never commits a real .env', async () => {
    const gitignore = await readFile(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
    await expect(stat(path.join(REPO_ROOT, '.env'))).rejects.toThrow();
  });
});
