import { getStorage, type Storage } from '../lib/storage.js';
import { emptyPayload, type DataProvider, type ProviderPayload } from './types.js';

/**
 * Built-in provider: reads JSON drops from `<RAW_DATA_ROOT>/inbox`.
 *
 * This is the reference implementation and ScoutIQ's guarantee that the
 * platform never depends on a third-party service to be useful. The inbox may
 * be a local directory, a NAS share, or an object-storage mount - it is just a
 * path from the environment.
 */
export class LocalFileProvider implements DataProvider {
  readonly key = 'local-file';
  readonly name = 'Local file drop';

  constructor(private readonly storage: Storage = getStorage()) {}

  isConfigured(): boolean {
    return true;
  }

  async fetch(): Promise<ProviderPayload> {
    const files = (await this.storage.list('raw', 'inbox')).filter((name) =>
      name.endsWith('.json'),
    );
    if (files.length === 0) return emptyPayload();

    const payload = emptyPayload();
    for (const file of files) {
      const chunk = await this.storage.readJson<Partial<ProviderPayload>>('raw', `inbox/${file}`);
      payload.players.push(...(chunk.players ?? []));
      payload.matchStats.push(...(chunk.matchStats ?? []));
    }
    return payload;
  }
}
