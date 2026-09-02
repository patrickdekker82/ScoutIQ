import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig, joinRoot, type StorageConfig } from '@/lib/config';

/**
 * Filesystem access for ScoutIQ.
 *
 * Every path derives from a configured root (§17). Nothing here knows or cares
 * whether that root is a local SSD, a mounted disk, a NAS export, VPS block
 * storage or an object-storage mount.
 *
 * The NAS is treated as optional infrastructure (§18): archive copies are
 * best-effort and the application keeps working when they fail.
 */

export const STORAGE_AREAS = [
  'raw',
  'normalized',
  'processed',
  'exports',
  'reports',
  'backups',
] as const;

export type StorageArea = (typeof STORAGE_AREAS)[number];

export class Storage {
  constructor(private readonly config: StorageConfig) {}

  static fromEnv(): Storage {
    return new Storage(getConfig().storage);
  }

  root(area: StorageArea): string {
    return this.config[area];
  }

  /**
   * Resolve a relative key inside an area.
   *
   * Rejects absolute paths and traversal, so a provider payload or a report
   * name can never escape its root - important when the root is a network
   * mount shared with other systems.
   */
  resolve(area: StorageArea, key: string): string {
    if (key.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(key)) {
      throw new Error(`Storage keys must be relative, received absolute path: ${key}`);
    }
    const root = this.root(area);
    const resolved = path.posix.normalize(joinRoot(root, key.replaceAll('\\', '/')));
    const normalisedRoot = path.posix.normalize(root.replace(/\/+$/, ''));
    if (resolved !== normalisedRoot && !resolved.startsWith(`${normalisedRoot}/`)) {
      throw new Error(`Storage key escapes its root: ${key}`);
    }
    return resolved;
  }

  async ensureArea(area: StorageArea): Promise<string> {
    const root = this.root(area);
    await mkdir(root, { recursive: true });
    return root;
  }

  async ensureAllAreas(): Promise<Record<StorageArea, string>> {
    const created = {} as Record<StorageArea, string>;
    for (const area of STORAGE_AREAS) {
      created[area] = await this.ensureArea(area);
    }
    return created;
  }

  async write(area: StorageArea, key: string, contents: string | Uint8Array): Promise<string> {
    const target = this.resolve(area, key);
    await mkdir(path.posix.dirname(target), { recursive: true });
    await writeFile(target, contents);
    return target;
  }

  async writeJson(area: StorageArea, key: string, value: unknown): Promise<string> {
    return this.write(area, key, `${JSON.stringify(value, null, 2)}\n`);
  }

  async read(area: StorageArea, key: string): Promise<Buffer> {
    return readFile(this.resolve(area, key));
  }

  async readJson<T>(area: StorageArea, key: string): Promise<T> {
    return JSON.parse((await this.read(area, key)).toString('utf8')) as T;
  }

  async list(area: StorageArea, prefix = ''): Promise<string[]> {
    const dir = prefix ? this.resolve(area, prefix) : this.root(area);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async remove(area: StorageArea, key: string): Promise<void> {
    await rm(this.resolve(area, key), { force: true });
  }

  async exists(area: StorageArea, key: string): Promise<boolean> {
    try {
      await access(this.resolve(area, key), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async size(area: StorageArea, key: string): Promise<number> {
    return (await stat(this.resolve(area, key))).size;
  }

  /**
   * Where an area's archive copy goes.
   *
   * NAS_DATASET_PATH / NAS_REPORT_PATH / NAS_BACKUP_PATH take precedence for
   * the areas they name (§18); ARCHIVE_ROOT is the catch-all. Returns null
   * when nothing is configured - which is a supported, fully working setup.
   */
  archiveTarget(area: StorageArea): string | null {
    const { archive, nasBackup, nasDataset, nasReport } = this.config;

    const specific =
      area === 'backups'
        ? nasBackup
        : area === 'reports'
          ? nasReport
          : area === 'raw' || area === 'normalized' || area === 'processed'
            ? nasDataset
            : null;

    if (specific) return specific;
    return archive ? joinRoot(archive, area) : null;
  }

  archiveConfigured(area?: StorageArea): boolean {
    if (area) return this.archiveTarget(area) !== null;
    return STORAGE_AREAS.some((candidate) => this.archiveTarget(candidate) !== null);
  }

  /**
   * Is an archive target actually writable right now?
   *
   * A NAS that is powered down, unmounted or unreachable must never break the
   * application - callers use this to skip the archive copy.
   */
  async archiveAvailable(area: StorageArea = 'backups'): Promise<boolean> {
    const target = this.archiveTarget(area);
    if (!target) return false;
    try {
      await mkdir(target, { recursive: true });
      await access(target, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Best-effort copy of a stored file to its archive target.
   * Returns the archive path, or null when archiving was skipped.
   */
  async archive(area: StorageArea, key: string): Promise<string | null> {
    const target = this.archiveTarget(area);
    if (!target) return null;
    if (!(await this.archiveAvailable(area))) return null;

    const destination = path.posix.normalize(joinRoot(target, key));
    await mkdir(path.posix.dirname(destination), { recursive: true });
    await writeFile(destination, await this.read(area, key));
    return destination;
  }

  /** Snapshot of which optional targets are configured and reachable. */
  async archiveStatus(): Promise<Record<StorageArea, 'ok' | 'unavailable' | 'not-configured'>> {
    const status = {} as Record<StorageArea, 'ok' | 'unavailable' | 'not-configured'>;
    for (const area of STORAGE_AREAS) {
      if (!this.archiveTarget(area)) {
        status[area] = 'not-configured';
      } else {
        status[area] = (await this.archiveAvailable(area)) ? 'ok' : 'unavailable';
      }
    }
    return status;
  }
}

let shared: Storage | undefined;

export function getStorage(): Storage {
  shared ??= Storage.fromEnv();
  return shared;
}

export function resetStorage(): void {
  shared = undefined;
}
