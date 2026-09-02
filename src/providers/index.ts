import { getConfig } from '../config/env.js';
import { HttpJsonProvider } from './http-json.provider.js';
import { LocalFileProvider } from './local-file.provider.js';
import type { DataProvider } from './types.js';

export * from './types.js';
export { HttpJsonProvider } from './http-json.provider.js';
export { LocalFileProvider } from './local-file.provider.js';

/**
 * Build the set of providers enabled through ENABLED_PROVIDERS.
 *
 * Unknown keys are ignored rather than fatal, so a deployment that lost access
 * to one supplier keeps importing from the others.
 */
export function buildProviders(): DataProvider[] {
  const config = getConfig();
  const providers: DataProvider[] = [];

  for (const key of config.providers.enabled) {
    switch (key) {
      case 'local-file':
        providers.push(new LocalFileProvider());
        break;
      case 'http-json':
        providers.push(new HttpJsonProvider(config.providers.httpJson));
        break;
      default:
        break;
    }
  }

  return providers;
}
