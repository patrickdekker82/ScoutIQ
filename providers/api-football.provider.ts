import { CoordinateSystem, ProviderKind } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { SourceClient } from '@/providers/fetch-client';
import {
  BaseProvider,
  type MatchQuery,
  type ProviderCapabilities,
  type ProviderCompetition,
  type ProviderLicence,
  type ProviderMatch,
  type ProviderPlayer,
  type ProviderSeason,
  type ProviderTeam,
  type PlayerQuery,
  type TeamQuery,
} from '@/providers/types';

/**
 * API-Football commercial API (§12, phase 8 of §88).
 *
 * Same contract as every other provider; the key stays server-side (§62).
 * Unconfigured without API_FOOTBALL_KEY, and skipped by the pipeline.
 */

interface AfResponse<T> {
  response: T[];
  errors?: unknown;
  paging?: { current: number; total: number };
}

interface AfLeagueEntry {
  league: { id: number; name: string; type: string };
  country: { name: string };
  seasons: { year: number; start: string; end: string }[];
}

interface AfTeamEntry {
  team: { id: number; name: string; code?: string; country?: string; founded?: number };
}

interface AfPlayerEntry {
  player: {
    id: number;
    firstname?: string;
    lastname?: string;
    name: string;
    birth?: { date?: string };
    nationality?: string;
    height?: string;
    weight?: string;
  };
  statistics?: { games?: { position?: string } }[];
}

interface AfFixture {
  fixture: { id: number; date: string; venue?: { name?: string } };
  league: { id: number; season: number; round?: string };
  teams: { home: { id: number }; away: { id: number } };
  goals: { home: number | null; away: number | null };
}

const parseCm = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export class ApiFootballProvider extends BaseProvider {
  readonly key = 'api-football';
  readonly name = 'API-Football';
  readonly kind = ProviderKind.COMMERCIAL_API;
  readonly version = 'v3';
  readonly coordinateSystem = CoordinateSystem.OPTA_100_100;

  readonly licence: ProviderLicence = {
    name: 'API-Football subscription',
    url: 'https://www.api-football.com/',
    notes: 'Governed by the API-Football terms; redistribution is restricted.',
    commercialUseAllowed: true,
    redistributionAllowed: false,
    attributionRequired: true,
  };

  readonly capabilities: ProviderCapabilities = {
    competitions: true,
    seasons: true,
    teams: true,
    players: true,
    matches: true,
    events: false,
    lineups: false,
    playerStats: false,
    teamStats: false,
    tracking: false,
  };

  private readonly client: SourceClient;

  constructor() {
    super();
    this.client = new SourceClient(getConfig().providers.apiFootball.baseUrl);
  }

  override isConfigured(): boolean {
    return Boolean(getConfig().providers.apiFootball.apiKey);
  }

  private headers(): Record<string, string> {
    const apiKey = getConfig().providers.apiFootball.apiKey;
    if (!apiKey) throw new Error('API_FOOTBALL_KEY is not configured');
    return { 'x-apisports-key': apiKey };
  }

  private async get<T>(path: string): Promise<T[]> {
    const response = await this.client.getJson<AfResponse<T>>(path, {
      headers: this.headers(),
      allowMissing: true,
    });
    return response?.response ?? [];
  }

  override async getCompetitions(): Promise<ProviderCompetition[]> {
    const leagues = await this.get<AfLeagueEntry>('leagues');
    return leagues.map((entry) => ({
      externalId: String(entry.league.id),
      name: entry.league.name,
      country: entry.country.name,
      type: entry.league.type?.toLowerCase() === 'cup' ? 'CUP' : 'LEAGUE',
    }));
  }

  override async getSeasons(competitionExternalId: string): Promise<ProviderSeason[]> {
    const leagues = await this.get<AfLeagueEntry>(`leagues?id=${competitionExternalId}`);
    const entry = leagues[0];
    if (!entry) return [];

    return entry.seasons.map((season) => ({
      externalId: String(season.year),
      competitionExternalId,
      name: `${season.year}/${season.year + 1}`,
      startDate: season.start,
      endDate: season.end,
    }));
  }

  override async getTeams(params: TeamQuery = {}): Promise<ProviderTeam[]> {
    if (!params.competitionExternalId || !params.seasonExternalId) {
      throw new Error('API-Football requires competitionExternalId and seasonExternalId');
    }

    const teams = await this.get<AfTeamEntry>(
      `teams?league=${params.competitionExternalId}&season=${params.seasonExternalId}`,
    );

    return teams.map((entry) => ({
      externalId: String(entry.team.id),
      name: entry.team.name,
      shortName: entry.team.code ?? null,
      country: entry.team.country ?? null,
      founded: entry.team.founded ?? null,
    }));
  }

  override async getPlayers(params: PlayerQuery = {}): Promise<ProviderPlayer[]> {
    if (!params.teamExternalId || !params.seasonExternalId) {
      throw new Error('API-Football requires teamExternalId and seasonExternalId');
    }

    const players = await this.get<AfPlayerEntry>(
      `players?team=${params.teamExternalId}&season=${params.seasonExternalId}`,
    );

    return players.map((entry) => ({
      externalId: String(entry.player.id),
      firstName: entry.player.firstname ?? entry.player.name,
      lastName: entry.player.lastname ?? '',
      fullName: entry.player.name,
      dateOfBirth: entry.player.birth?.date ?? null,
      nationality: entry.player.nationality ?? null,
      heightCm: parseCm(entry.player.height),
      position: entry.statistics?.[0]?.games?.position ?? null,
      teamExternalId: params.teamExternalId,
    }));
  }

  override async getMatches(params: MatchQuery = {}): Promise<ProviderMatch[]> {
    if (!params.competitionExternalId || !params.seasonExternalId) {
      throw new Error('API-Football requires competitionExternalId and seasonExternalId');
    }

    const fixtures = await this.get<AfFixture>(
      `fixtures?league=${params.competitionExternalId}&season=${params.seasonExternalId}`,
    );

    // Incremental synchronisation (§88 phase 8): the API has no "changed since"
    // filter, so the window is applied to kickoff time after the fetch. That
    // saves writes, not requests - the request cost is unchanged.
    const windowed = params.since
      ? fixtures.filter((entry) => new Date(entry.fixture.date) >= params.since!)
      : fixtures;

    return windowed.slice(0, params.limit ?? windowed.length).map((entry) => ({
      externalId: String(entry.fixture.id),
      competitionExternalId: String(entry.league.id),
      seasonExternalId: String(entry.league.season),
      homeTeamExternalId: String(entry.teams.home.id),
      awayTeamExternalId: String(entry.teams.away.id),
      kickoffAt: entry.fixture.date,
      homeScore: entry.goals.home,
      awayScore: entry.goals.away,
      venue: entry.fixture.venue?.name ?? null,
      stage: entry.league.round ?? null,
    }));
  }
}
