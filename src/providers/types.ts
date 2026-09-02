/**
 * Provider contract.
 *
 * A provider turns some external source into ScoutIQ's normalised shape. The
 * contract is intentionally small so any provider - a file drop, an HTTP API,
 * a Playwright-based ingest service, or a future replacement - can be swapped
 * in through configuration alone. None of them is mandatory: ScoutIQ runs
 * fully self-hosted with the built-in `local-file` provider.
 */

export interface NormalisedPlayer {
  externalId: string;
  firstName: string;
  lastName: string;
  position: string;
  birthDate?: string | null;
  nationality?: string | null;
  footPref?: string | null;
  heightCm?: number | null;
  teamName?: string | null;
  teamCountry?: string | null;
}

export interface NormalisedMatchStat {
  externalPlayerId: string;
  externalMatchId: string;
  kickoffAt: string;
  competition: string;
  season: string;
  homeTeam: string;
  awayTeam: string;
  country: string;
  minutesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  xg: number;
  xa: number;
  passes: number;
  passesCompleted: number;
  progressivePasses: number;
  duelsWon: number;
  duelsTotal: number;
}

export interface ProviderPayload {
  players: NormalisedPlayer[];
  matchStats: NormalisedMatchStat[];
}

export interface ProviderContext {
  /** Milliseconds; providers must not block a worker indefinitely. */
  timeoutMs: number;
  since?: Date;
}

export interface DataProvider {
  readonly key: string;
  readonly name: string;
  /** Whether the provider has everything it needs (config, reachable source). */
  isConfigured(): boolean;
  fetch(context: ProviderContext): Promise<ProviderPayload>;
}

export const emptyPayload = (): ProviderPayload => ({ players: [], matchStats: [] });
