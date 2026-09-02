import { getConfig } from '@/lib/config';
import { ApiFootballProvider } from '@/providers/api-football.provider';
import { CsvJsonProvider } from '@/providers/csv-json.provider';
import { DemoProvider } from '@/providers/demo.provider';
import { MetricaProvider } from '@/providers/metrica.provider';
import { SkillCornerProvider } from '@/providers/skillcorner.provider';
import { SportmonksProvider } from '@/providers/sportmonks.provider';
import { StatsBombProvider } from '@/providers/statsbomb.provider';
import type { FootballDataProvider } from '@/providers/types';

export * from '@/providers/types';
export { StatsBombProvider } from '@/providers/statsbomb.provider';
export { SkillCornerProvider } from '@/providers/skillcorner.provider';
export { MetricaProvider } from '@/providers/metrica.provider';
export { CsvJsonProvider } from '@/providers/csv-json.provider';
export { DemoProvider } from '@/providers/demo.provider';
export { SportmonksProvider } from '@/providers/sportmonks.provider';
export { ApiFootballProvider } from '@/providers/api-football.provider';

/**
 * Provider registry.
 *
 * The registry is the only place that knows which implementations exist. The
 * UI, the import pipeline and the analytics never name a provider - they ask
 * the registry - which is what keeps ScoutIQ provider-agnostic (§92).
 */
export type ProviderKey =
  | 'statsbomb-open'
  | 'skillcorner-open'
  | 'metrica-sample'
  | 'csv-json'
  | 'scoutiq-demo'
  | 'sportmonks'
  | 'api-football';

type Factory = () => FootballDataProvider;

const FACTORIES: Record<ProviderKey, Factory> = {
  'statsbomb-open': () => new StatsBombProvider(),
  'skillcorner-open': () => new SkillCornerProvider(),
  'metrica-sample': () => new MetricaProvider(),
  'csv-json': () => new CsvJsonProvider(),
  'scoutiq-demo': () => new DemoProvider(),
  sportmonks: () => new SportmonksProvider(),
  'api-football': () => new ApiFootballProvider(),
};

export const PROVIDER_KEYS = Object.keys(FACTORIES) as ProviderKey[];

export function createProvider(key: string): FootballDataProvider {
  const factory = FACTORIES[key as ProviderKey];
  if (!factory) throw new Error(`Unknown provider: ${key}`);
  return factory();
}

/** Every provider, whether or not it is currently usable. */
export function allProviders(): FootballDataProvider[] {
  return PROVIDER_KEYS.map((key) => createProvider(key));
}

/**
 * Providers that are enabled AND have what they need to run.
 *
 * A missing API key is not an error: the provider simply is not available,
 * and the rest of ScoutIQ carries on (§73).
 */
export function availableProviders(): FootballDataProvider[] {
  const config = getConfig();

  return allProviders().filter((provider) => {
    if (!provider.isConfigured()) return false;
    if (provider.key === 'scoutiq-demo') return config.providers.demo.enabled;
    return true;
  });
}

export interface ProviderSummary {
  key: string;
  name: string;
  kind: string;
  version: string;
  configured: boolean;
  capabilities: Record<string, boolean>;
  licence: {
    name: string;
    url?: string | undefined;
    notes?: string | undefined;
    commercialUseAllowed: boolean;
    redistributionAllowed: boolean;
    attributionRequired: boolean;
  };
  coordinateSystem: string;
}

/** Registry view for the UI and the API, licensing included (§13). */
export function describeProviders(): ProviderSummary[] {
  return allProviders().map((provider) => ({
    key: provider.key,
    name: provider.name,
    kind: provider.kind,
    version: provider.version,
    configured: provider.isConfigured(),
    capabilities: { ...provider.capabilities },
    licence: {
      name: provider.licence.name,
      url: provider.licence.url,
      notes: provider.licence.notes,
      commercialUseAllowed: provider.licence.commercialUseAllowed,
      redistributionAllowed: provider.licence.redistributionAllowed,
      attributionRequired: provider.licence.attributionRequired,
    },
    coordinateSystem: provider.coordinateSystem,
  }));
}
