import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig, joinRoot, type StorageConfig } from '../config/env.js';

/**
 * Filesystem access for ScoutIQ.
 *
 * Every path is derived from a configured root (DATA_ROOT, RAW_DATA_ROOT,
 * EXPORT_ROOT, REPORT_ROOT, BACKUP_ROOT). Nothing here knows or cares whether
 * that root is a local SSD, a mounted disk, a NAS export, VPS block storage or
 * an object-storage FUSE mount.
 *
 * The optional archive root (typically a NAS) is treated as *optional
 * infrastructure*: when it is unavailable, ScoutIQ keeps functioning and only
 * the archive copy is skipped.
 */

export type StorageArea = 'raw' | 'exports' | 'reports' | 'backups';

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
   * Rejects absolute paths and traversal so a provider or a report name can
   * never escape the configured root - important when the root is a network
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
    const areas: StorageArea[] = ['raw', 'exports', 'reports', 'backups'];
    const created = {} as Record<StorageArea, string>;
    for (const area of areas) {
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
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
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

  /** Is a secondary archive target configured at all? */
  get archiveConfigured(): boolean {
    return this.config.archive !== null;
  }

  /**
   * Is the archive target actually writable right now?
   *
   * A NAS that is powered down, unmounted or unreachable must never break the
   * application - callers use this to skip the archive copy.
   */
  async archiveAvailable(): Promise<boolean> {
    const archive = this.config.archive;
    if (!archive) return false;
    try {
      await mkdir(archive, { recursive: true });
      await access(archive, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Best-effort copy of a stored file to the optional archive root.
   * Returns the archive path, or null when archiving was skipped.
   */
  async archive(area: StorageArea, key: string): Promise<string | null> {
    if (!(await this.archiveAvailable())) return null;
    const archiveRoot = this.config.archive as string;
    const target = path.posix.normalize(joinRoot(joinRoot(archiveRoot, area), key));
    await mkdir(path.posix.dirname(target), { recursive: true });
    await writeFile(target, await this.read(area, key));
    return target;
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
