import type { CoordinateSystem, ProviderKind } from '@prisma/client';

/**
 * Provider abstraction (§12).
 *
 * Every source of football data - open dataset, commercial API, file drop -
 * implements this interface and returns the same canonical shapes. Provider
 * logic never reaches the UI (§92): the application only ever sees these types.
 *
 * Methods a provider cannot serve throw `NotSupportedError`, which the import
 * pipeline records as a warning rather than a failure. That is what lets
 * ScoutIQ move from open data to a paid provider without a rewrite.
 */

export class NotSupportedError extends Error {
  constructor(provider: string, capability: string) {
    super(`Provider ${provider} does not support ${capability}`);
    this.name = 'NotSupportedError';
  }
}

export interface ProviderLicence {
  name: string;
  url?: string;
  notes?: string;
  /** Conservative defaults: open access never implies these are true (§13). */
  commercialUseAllowed: boolean;
  redistributionAllowed: boolean;
  attributionRequired: boolean;
}

export interface ProviderCapabilities {
  competitions: boolean;
  seasons: boolean;
  teams: boolean;
  players: boolean;
  matches: boolean;
  events: boolean;
  lineups: boolean;
  playerStats: boolean;
  teamStats: boolean;
  tracking: boolean;
}

export interface ProviderCompetition {
  externalId: string;
  name: string;
  country?: string | null;
  tier?: number | null;
  type?: 'LEAGUE' | 'CUP' | 'INTERNATIONAL' | 'FRIENDLY';
  gender?: 'MALE' | 'FEMALE' | 'MIXED';
}

export interface ProviderSeason {
  externalId: string;
  competitionExternalId: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ProviderTeam {
  externalId: string;
  name: string;
  shortName?: string | null;
  country?: string | null;
  founded?: number | null;
}

export interface ProviderPlayer {
  externalId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  knownAs?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  preferredFoot?: 'LEFT' | 'RIGHT' | 'BOTH' | 'UNKNOWN';
  position?: string | null;
  teamExternalId?: string | null;
}

export interface ProviderMatch {
  externalId: string;
  competitionExternalId: string;
  seasonExternalId: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  kickoffAt: string;
  homeScore?: number | null;
  awayScore?: number | null;
  venue?: string | null;
  matchweek?: number | null;
  stage?: string | null;
  attendance?: number | null;
  referee?: string | null;
}

export interface ProviderLineupPlayer {
  playerExternalId: string;
  teamExternalId: string;
  position?: string | null;
  shirtNumber?: number | null;
  isStarter: boolean;
  minutesPlayed?: number | null;
  minuteOn?: number | null;
  minuteOff?: number | null;
}

export interface ProviderLineup {
  matchExternalId: string;
  teamExternalId: string;
  formation?: string | null;
  players: ProviderLineupPlayer[];
}

/**
 * An event in PROVIDER coordinates. The import pipeline runs every event
 * through the coordinate transformation layer (§33) before it is stored, using
 * `coordinateSystem` below.
 */
export interface ProviderEvent {
  externalId: string;
  matchExternalId: string;
  teamExternalId?: string | null;
  playerExternalId?: string | null;
  possessionTeamExternalId?: string | null;
  type: string;
  subType?: string | null;
  minute: number;
  second?: number;
  period?: number;
  timestampMs?: number;
  x?: number | null;
  y?: number | null;
  endX?: number | null;
  endY?: number | null;
  outcome?: string | null;
  underPressure?: boolean;
  durationSec?: number | null;
  playPattern?: string | null;
  possessionId?: number | null;
  /** Type-specific attributes, normalised by the importer. */
  detail?: Record<string, unknown>;
  raw?: unknown;
}

export interface ProviderPlayerStat {
  playerExternalId: string;
  matchExternalId?: string | null;
  seasonExternalId?: string | null;
  minutes?: number | null;
  stats: Record<string, number>;
}

export interface ProviderTeamStat {
  teamExternalId: string;
  matchExternalId?: string | null;
  seasonExternalId?: string | null;
  stats: Record<string, number>;
}

export interface ProviderTrackingFrame {
  matchExternalId: string;
  frameIndex: number;
  timestampMs: number;
  period: number;
  ballInPlay: boolean;
  possessionTeamExternalId?: string | null;
  ball?: { x: number; y: number; z?: number | null } | null;
  players: {
    playerExternalId: string | null;
    teamExternalId: string | null;
    x: number;
    y: number;
    speedMs?: number | null;
  }[];
}

export interface TeamQuery {
  competitionExternalId?: string;
  seasonExternalId?: string;
}

export interface PlayerQuery extends TeamQuery {
  teamExternalId?: string;
}

export interface MatchQuery extends TeamQuery {
  since?: Date;
  limit?: number;
}

export interface PlayerStatsQuery extends PlayerQuery {
  matchExternalId?: string;
}

export interface TeamStatsQuery extends TeamQuery {
  matchExternalId?: string;
}

/**
 * The provider contract of §12, widened only where the pipeline genuinely
 * needs it (licensing, capabilities, coordinate system, provenance).
 */
export interface FootballDataProvider {
  readonly key: string;
  readonly name: string;
  readonly kind: ProviderKind;
  readonly version: string;
  readonly licence: ProviderLicence;
  readonly capabilities: ProviderCapabilities;
  readonly coordinateSystem: CoordinateSystem;

  /** Is everything this provider needs present (keys, reachable source)? */
  isConfigured(): boolean;

  getCompetitions(): Promise<ProviderCompetition[]>;
  getSeasons(competitionExternalId: string): Promise<ProviderSeason[]>;
  getTeams(params?: TeamQuery): Promise<ProviderTeam[]>;
  getPlayers(params?: PlayerQuery): Promise<ProviderPlayer[]>;
  getMatches(params?: MatchQuery): Promise<ProviderMatch[]>;
  getEvents(matchExternalId: string): Promise<ProviderEvent[]>;
  getLineups(matchExternalId: string): Promise<ProviderLineup[]>;
  getPlayerStats(params: PlayerStatsQuery): Promise<ProviderPlayerStat[]>;
  getTeamStats(params: TeamStatsQuery): Promise<ProviderTeamStat[]>;
  getTrackingData(matchExternalId: string): Promise<ProviderTrackingFrame[]>;
}

/** Convenience base: everything unsupported until a subclass says otherwise. */
export abstract class BaseProvider implements FootballDataProvider {
  abstract readonly key: string;
  abstract readonly name: string;
  abstract readonly kind: ProviderKind;
  abstract readonly version: string;
  abstract readonly licence: ProviderLicence;
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly coordinateSystem: CoordinateSystem;

  isConfigured(): boolean {
    return true;
  }

  protected unsupported(capability: string): never {
    throw new NotSupportedError(this.key, capability);
  }

  async getCompetitions(): Promise<ProviderCompetition[]> {
    return this.unsupported('competitions');
  }
  async getSeasons(_competitionExternalId: string): Promise<ProviderSeason[]> {
    return this.unsupported('seasons');
  }
  async getTeams(_params?: TeamQuery): Promise<ProviderTeam[]> {
    return this.unsupported('teams');
  }
  async getPlayers(_params?: PlayerQuery): Promise<ProviderPlayer[]> {
    return this.unsupported('players');
  }
  async getMatches(_params?: MatchQuery): Promise<ProviderMatch[]> {
    return this.unsupported('matches');
  }
  async getEvents(_matchExternalId: string): Promise<ProviderEvent[]> {
    return this.unsupported('events');
  }
  async getLineups(_matchExternalId: string): Promise<ProviderLineup[]> {
    return this.unsupported('lineups');
  }
  async getPlayerStats(_params: PlayerStatsQuery): Promise<ProviderPlayerStat[]> {
    return this.unsupported('player stats');
  }
  async getTeamStats(_params: TeamStatsQuery): Promise<ProviderTeamStat[]> {
    return this.unsupported('team stats');
  }
  async getTrackingData(_matchExternalId: string): Promise<ProviderTrackingFrame[]> {
    return this.unsupported('tracking data');
  }
}

export const noCapabilities = (): ProviderCapabilities => ({
  competitions: false,
  seasons: false,
  teams: false,
  players: false,
  matches: false,
  events: false,
  lineups: false,
  playerStats: false,
  teamStats: false,
  tracking: false,
});
