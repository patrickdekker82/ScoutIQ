import { describe, expect, it } from 'vitest';
import { buildConfig, joinRoot } from '../src/config/env.js';

const base: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://u:p@db:5432/scoutiq',
  REDIS_URL: 'redis://cache:6379',
  AUTH_SECRET: 'x'.repeat(32),
};

describe('configuration', () => {
  it('derives every storage path from DATA_ROOT by default', () => {
    const config = buildConfig({ ...base, DATA_ROOT: '/srv/scoutiq' });

    expect(config.storage).toMatchObject({
      root: '/srv/scoutiq',
      raw: '/srv/scoutiq/raw',
      exports: '/srv/scoutiq/exports',
      reports: '/srv/scoutiq/reports',
      backups: '/srv/scoutiq/backups',
      archive: null,
    });
  });

  it('lets every path be overridden independently (separate mounts)', () => {
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

  it('treats the archive root as optional', () => {
    expect(buildConfig(base).storage.archive).toBeNull();
    expect(buildConfig({ ...base, ARCHIVE_ROOT: '/mnt/nas' }).storage.archive).toBe('/mnt/nas');
  });

  it('falls back to DATABASE_URL when no analytics replica is configured', () => {
    expect(buildConfig(base).database.analyticsUrl).toBe(base.DATABASE_URL);
    expect(
      buildConfig({ ...base, ANALYTICS_DATABASE_URL: 'postgresql://u:p@replica:5432/scoutiq' })
        .database.analyticsUrl,
    ).toContain('replica');
  });

  it('rejects an incomplete environment with an actionable message', () => {
    expect(() => buildConfig({ DATABASE_URL: base.DATABASE_URL })).toThrowError(/REDIS_URL/);
    expect(() => buildConfig({ ...base, AUTH_SECRET: 'short' })).toThrowError(/AUTH_SECRET/);
  });

  it('parses booleans and lists the way operators write them', () => {
    expect(buildConfig({ ...base, SCHEDULER_ENABLED: 'false' }).scheduler.enabled).toBe(false);
    expect(buildConfig({ ...base, SCHEDULER_ENABLED: 'yes' }).scheduler.enabled).toBe(true);
    expect(buildConfig({ ...base, ENABLED_PROVIDERS: 'local-file, http-json' }).providers.enabled).toEqual(
      ['local-file', 'http-json'],
    );
    expect(buildConfig({ ...base, CORS_ORIGINS: '*' }).http.corsOrigins).toBe(true);
    expect(buildConfig({ ...base, CORS_ORIGINS: 'https://a.example,https://b.example' }).http.corsOrigins)
      .toEqual(['https://a.example', 'https://b.example']);
  });

  it('joins roots with POSIX semantics regardless of build host', () => {
    expect(joinRoot('/data/', '/raw')).toBe('/data/raw');
    expect(joinRoot('/data', 'raw')).toBe('/data/raw');
  });
});
