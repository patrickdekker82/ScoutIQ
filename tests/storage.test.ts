import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/lib/storage.js';
import type { StorageConfig } from '../src/config/env.js';

let sandbox: string;
let storage: Storage;
let config: StorageConfig;

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'scoutiq-storage-'));
  config = {
    root: sandbox,
    raw: path.join(sandbox, 'raw'),
    exports: path.join(sandbox, 'exports'),
    reports: path.join(sandbox, 'reports'),
    backups: path.join(sandbox, 'backups'),
    archive: null,
  };
  storage = new Storage(config);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('storage', () => {
  it('creates every area under the configured roots', async () => {
    const roots = await storage.ensureAllAreas();
    expect(roots.reports).toBe(config.reports);
    expect(await storage.list('reports')).toEqual([]);
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
    await expect(storage.write('reports', 'C:\\windows\\evil', 'x')).rejects.toThrow(/must be relative/);
  });

  it('reports an absent area as empty rather than throwing', async () => {
    expect(await storage.list('exports')).toEqual([]);
    expect(await storage.exists('exports', 'nothing.csv')).toBe(false);
  });

  it('treats an unconfigured archive as optional', async () => {
    expect(storage.archiveConfigured).toBe(false);
    expect(await storage.archiveAvailable()).toBe(false);

    await storage.write('reports', 'a.md', 'x');
    expect(await storage.archive('reports', 'a.md')).toBeNull();
  });

  it('copies to the archive when it is available', async () => {
    const archiveRoot = path.join(sandbox, 'nas');
    const withArchive = new Storage({ ...config, archive: archiveRoot });

    await withArchive.write('reports', '2025/a.md', 'scouting');
    const target = await withArchive.archive('reports', '2025/a.md');

    expect(target).toBe(path.posix.join(archiveRoot, 'reports/2025/a.md'));
    expect((await readFile(target as string)).toString()).toBe('scouting');
  });

  it('keeps working when the archive target is unreachable', async () => {
    // Simulate an unmounted NAS: the parent exists but is not a directory.
    const blocked = path.join(sandbox, 'blocked');
    await mkdir(path.dirname(blocked), { recursive: true });
    await writeFile(blocked, 'not a directory');

    const withBrokenArchive = new Storage({ ...config, archive: path.join(blocked, 'scoutiq') });

    expect(withBrokenArchive.archiveConfigured).toBe(true);
    expect(await withBrokenArchive.archiveAvailable()).toBe(false);

    // The primary write must still succeed - the NAS is optional.
    await withBrokenArchive.write('reports', 'b.md', 'still works');
    expect(await withBrokenArchive.archive('reports', 'b.md')).toBeNull();
    expect((await withBrokenArchive.read('reports', 'b.md')).toString()).toBe('still works');
  });
});
