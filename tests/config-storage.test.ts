import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildConfig, joinRoot, type StorageConfig } from '@/lib/config';
import { Storage, STORAGE_AREAS } from '@/lib/storage';

const base: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@db:5432/scoutiq',
  REDIS_URL: 'redis://cache:6379',
  AUTH_SECRET: 'x'.repeat(32),
};

/** Portability contract (supplementary spec; §17, §18, §69, §74). */
describe('configuration', () => {
  it('derives every storage path from DATA_ROOT by default', () => {
    const config = buildConfig({ ...base, DATA_ROOT: '/srv/scoutiq' });

    expect(config.storage).toMatchObject({
      root: '/srv/scoutiq',
      raw: '/srv/scoutiq/raw',
      normalized: '/srv/scoutiq/normalized',
      processed: '/srv/scoutiq/processed',
      exports: '/srv/scoutiq/exports',
      reports: '/srv/scoutiq/reports',
      backups: '/srv/scoutiq/backups',
    });
  });

  it('lets every path be overridden independently, for separate mounts', () => {
    const config = buildConfig({
      ...base,
      DATA_ROOT: '/data',
      REPORT_ROOT: '/mnt/nas/reports',
      BACKUP_ROOT: '/mnt/blockstorage/backups',
    });

    expect(config.storage.reports).toBe('/mnt/nas/reports');
    expect(config.storage.backups).toBe('/mnt/blockstorage/backups');
    expect(config.storage.raw).toBe('/data/raw');
  });

  it('treats every NAS path as optional', () => {
    const config = buildConfig(base);
    expect(config.storage.nasBackup).toBeNull();
    expect(config.storage.nasDataset).toBeNull();
    expect(config.storage.nasReport).toBeNull();
    expect(config.storage.archive).toBeNull();
  });

  it('accepts NEXTAUTH_SECRET as an alias for AUTH_SECRET', () => {
    const { AUTH_SECRET, ...withoutAuth } = base;
    void AUTH_SECRET;
    const config = buildConfig({ ...withoutAuth, NEXTAUTH_SECRET: 'y'.repeat(32) });
    expect(config.auth.secret).toBe('y'.repeat(32));
  });

  it('falls back to DATABASE_URL for the direct and analytics connections', () => {
    const config = buildConfig(base);
    expect(config.database.directUrl).toBe(base.DATABASE_URL);
    expect(config.database.analyticsUrl).toBe(base.DATABASE_URL);

    const split = buildConfig({
      ...base,
      DIRECT_DATABASE_URL: 'postgresql://u:p@primary:5432/scoutiq',
      ANALYTICS_DATABASE_URL: 'postgresql://u:p@replica:5432/scoutiq',
    });
    expect(split.database.directUrl).toContain('primary');
    expect(split.database.analyticsUrl).toContain('replica');
  });

  it('rejects an incomplete environment with an actionable message', () => {
    expect(() => buildConfig({ NODE_ENV: 'test', DATABASE_URL: base.DATABASE_URL })).toThrow(
      /REDIS_URL/,
    );
    expect(() => buildConfig({ ...base, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('parses the booleans and lists operators actually write', () => {
    expect(buildConfig({ ...base, SCHEDULER_ENABLED: 'false' }).scheduler.enabled).toBe(false);
    expect(buildConfig({ ...base, SCHEDULER_ENABLED: 'yes' }).scheduler.enabled).toBe(true);
    expect(
      buildConfig({ ...base, ENABLE_STATSBOMB_OPEN_DATA: '0' }).providers.statsbomb.enabled,
    ).toBe(false);
    expect(
      buildConfig({ ...base, CORS_ORIGINS: 'https://a.example, https://b.example' }).http
        .corsOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  it('joins roots with POSIX semantics regardless of build host', () => {
    expect(joinRoot('/data/', '/raw')).toBe('/data/raw');
    expect(joinRoot('/data', 'raw')).toBe('/data/raw');
  });
});

describe('storage', () => {
  let sandbox: string;
  let config: StorageConfig;
  let storage: Storage;

  beforeEach(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'scoutiq-storage-'));
    config = {
      root: sandbox,
      raw: path.join(sandbox, 'raw'),
      normalized: path.join(sandbox, 'normalized'),
      processed: path.join(sandbox, 'processed'),
      exports: path.join(sandbox, 'exports'),
      reports: path.join(sandbox, 'reports'),
      backups: path.join(sandbox, 'backups'),
      archive: null,
      nasBackup: null,
      nasDataset: null,
      nasReport: null,
    };
    storage = new Storage(config);
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it('creates every area named in §17', async () => {
    const roots = await storage.ensureAllAreas();
    expect(Object.keys(roots).sort()).toEqual([...STORAGE_AREAS].sort());
  });

  it('round-trips documents and JSON', async () => {
    await storage.write('reports', '2025/player/report.md', '# hello');
    expect((await storage.read('reports', '2025/player/report.md')).toString()).toBe('# hello');

    await storage.writeJson('raw', 'inbox/drop.json', { players: [] });
    expect(await storage.readJson('raw', 'inbox/drop.json')).toEqual({ players: [] });
  });

  it('refuses keys that escape their root', async () => {
    await expect(storage.write('reports', '../escape.md', 'x')).rejects.toThrow(/escapes its root/);
    await expect(storage.write('reports', '/etc/passwd', 'x')).rejects.toThrow(/must be relative/);
    await expect(storage.write('reports', 'C:\\windows\\evil', 'x')).rejects.toThrow(
      /must be relative/,
    );
  });

  it('routes each area to the NAS path that names it (§18)', () => {
    const withNas = new Storage({
      ...config,
      nasBackup: '/mnt/nas/backups',
      nasReport: '/mnt/nas/reports',
      nasDataset: '/mnt/nas/datasets',
      archive: '/mnt/archive',
    });

    expect(withNas.archiveTarget('backups')).toBe('/mnt/nas/backups');
    expect(withNas.archiveTarget('reports')).toBe('/mnt/nas/reports');
    expect(withNas.archiveTarget('raw')).toBe('/mnt/nas/datasets');
    // Anything not named by a NAS variable falls back to ARCHIVE_ROOT.
    expect(withNas.archiveTarget('exports')).toBe('/mnt/archive/exports');
  });

  it('treats an unconfigured archive as optional', async () => {
    expect(storage.archiveConfigured()).toBe(false);
    await storage.write('reports', 'a.md', 'x');
    expect(await storage.archive('reports', 'a.md')).toBeNull();
  });

  it('copies to the archive when it is available', async () => {
    const withArchive = new Storage({ ...config, nasReport: path.join(sandbox, 'nas-reports') });

    await withArchive.write('reports', '2025/a.md', 'scouting');
    const target = await withArchive.archive('reports', '2025/a.md');

    expect(target).toContain('nas-reports');
    expect((await readFile(target as string)).toString()).toBe('scouting');
  });

  it('keeps working when the NAS is unreachable', async () => {
    // A file where a directory should be: what an unmounted share looks like.
    const blocked = path.join(sandbox, 'blocked');
    await mkdir(path.dirname(blocked), { recursive: true });
    await writeFile(blocked, 'not a directory');

    const broken = new Storage({ ...config, nasReport: path.join(blocked, 'scoutiq') });

    expect(broken.archiveConfigured('reports')).toBe(true);
    expect(await broken.archiveAvailable('reports')).toBe(false);

    await broken.write('reports', 'b.md', 'still works');
    expect(await broken.archive('reports', 'b.md')).toBeNull();
    expect((await broken.read('reports', 'b.md')).toString()).toBe('still works');
  });

  it('reports archive status per area for the health endpoint', async () => {
    const status = await storage.archiveStatus();
    expect(status.backups).toBe('not-configured');
    expect(status.reports).toBe('not-configured');
  });
});
