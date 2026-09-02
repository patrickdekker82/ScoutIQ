import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';

/**
 * Shared HTTP/file client for providers (§61).
 *
 * - Never called on a page render: only import jobs use it.
 * - Retries 429 and 5xx with exponential backoff, honouring Retry-After.
 * - Reads from a local directory instead of the network when the provider is
 *   configured with a local path (a NAS copy of an open dataset, say), which
 *   also makes imports work on a machine with no internet access (§67).
 */

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Treat 404 as "no data" rather than an error. */
  allowMissing?: boolean;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class SourceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly localPath?: string | undefined,
  ) {}

  get usesLocalSource(): boolean {
    return Boolean(this.localPath);
  }

  describe(): string {
    return this.localPath ?? this.baseUrl;
  }

  /**
   * Fetch a JSON document by relative path, e.g. `competitions.json`.
   * Returns null when the resource is absent and `allowMissing` is set.
   */
  async getJson<T>(relativePath: string, options: FetchOptions = {}): Promise<T | null> {
    if (this.localPath) return this.readLocal<T>(relativePath, options);
    return this.readRemote<T>(relativePath, options);
  }

  private async readLocal<T>(relativePath: string, options: FetchOptions): Promise<T | null> {
    const target = path.resolve(this.localPath as string, relativePath);
    const root = path.resolve(this.localPath as string);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Refusing to read outside the provider directory: ${relativePath}`);
    }

    try {
      return JSON.parse(await readFile(target, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && options.allowMissing) return null;
      throw error;
    }
  }

  private async readRemote<T>(relativePath: string, options: FetchOptions): Promise<T | null> {
    const config = getConfig();
    const timeoutMs = options.timeoutMs ?? config.providers.timeoutMs;
    const maxRetries = options.maxRetries ?? config.providers.maxRetries;
    const url = `${this.baseUrl.replace(/\/+$/, '')}/${relativePath.replace(/^\/+/, '')}`;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, {
          headers: { accept: 'application/json', ...options.headers },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status === 404 && options.allowMissing) return null;

        if (response.status === 429 || response.status >= 500) {
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30_000, 2 ** attempt * 1000);

          if (attempt < maxRetries) {
            logger.warn(
              { url, status: response.status, attempt, delay },
              'provider throttled or unavailable; retrying',
            );
            await sleep(delay);
            attempt += 1;
            continue;
          }
        }

        if (!response.ok) {
          throw new ProviderHttpError(
            `Request failed: ${response.status} ${response.statusText}`,
            response.status,
            url,
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        // Network error or timeout: retry, unless we are out of attempts.
        if (error instanceof ProviderHttpError) throw error;
        if (attempt >= maxRetries) break;
        await sleep(Math.min(30_000, 2 ** attempt * 1000));
        attempt += 1;
      }
    }

    throw new Error(
      `Failed to fetch ${url} after ${maxRetries + 1} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }
}
