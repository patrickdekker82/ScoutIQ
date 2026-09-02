import type { AppConfig } from '../config/env.js';
import { emptyPayload, type DataProvider, type ProviderContext, type ProviderPayload } from './types.js';

/**
 * Generic HTTP/JSON provider.
 *
 * Points at any endpoint that returns `{ players, matchStats }`. Because the
 * base URL and API key come from the environment, replacing one commercial
 * data supplier with another - or with a self-hosted scraper - is a config
 * change, not a code change.
 */
export class HttpJsonProvider implements DataProvider {
  readonly key = 'http-json';
  readonly name = 'HTTP JSON endpoint';

  constructor(private readonly config: AppConfig['providers']['httpJson']) {}

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl);
  }

  async fetch(context: ProviderContext): Promise<ProviderPayload> {
    if (!this.config.baseUrl) return emptyPayload();

    const url = new URL('/v1/export', this.config.baseUrl);
    if (context.since) url.searchParams.set('since', context.since.toISOString());

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(context.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Provider ${this.key} responded ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as Partial<ProviderPayload>;
    return { players: body.players ?? [], matchStats: body.matchStats ?? [] };
  }
}
