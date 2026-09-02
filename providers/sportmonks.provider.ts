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
 * Sportmonks commercial API (§12, phase 8 of §88).
 *
 * The API key never leaves the server (§62, §92): it is read from the
 * environment inside this class and attached to outgoing requests only.
 *
 * Sportmonks is a paid provider. Without SPORTMONKS_API_KEY this provider
 * reports itself as unconfigured and the import pipeline skips it, which is
 * why ScoutIQ runs perfectly well without ever touching it.
 */

interface SmPaginated<T> {
  data: T[];
  pagination?: { has_more?: boolean; current_page?: number };
}

interface SmLeague {
  id: number;
  name: string;
  country_id?: number;
  type?: string;
}

interface SmSeason {
  id: number;
  league_id: number;
  name: string;
  starting_at?: string;
  ending_at?: string;
}

interface SmTeam {
  id: number;
  name: string;
  short_code?: string;
  founded?: number;
  country_id?: number;
}

interface SmPlayer {
  id: number;
  firstname?: string;
  lastname?: string;
  display_name?: string;
  date_of_birth?: string;
  height?: number;
  weight?: number;
  nationality_id?: number;
  position?: { name?: string };
}

interface SmFixture {
  id: number;
  league_id: number;
  season_id: number;
  starting_at: string;
  participants?: { id: number; meta?: { location?: string } }[];
  scores?: { score?: { goals?: number; participant?: string }; description?: string }[];
}

export class SportmonksProvider extends BaseProvider {
  readonly key = 'sportmonks';
  readonly name = 'Sportmonks';
  readonly kind = ProviderKind.COMMERCIAL_API;
  readonly version = 'v3';
  readonly coordinateSystem = CoordinateSystem.OPTA_100_100;

  readonly licence: ProviderLicence = {
    name: 'Sportmonks commercial subscription',
    url: 'https://www.sportmonks.com/',
    notes:
      'Usage is governed by the subscription agreement. Redistribution of raw ' +
      'data is normally prohibited; check the plan before exporting.',
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
    this.client = new SourceClient(getConfig().providers.sportmonks.baseUrl);
  }

  override isConfigured(): boolean {
    return Boolean(getConfig().providers.sportmonks.apiKey);
  }

  private headers(): Record<string, string> {
    const apiKey = getConfig().providers.sportmonks.apiKey;
    if (!apiKey) throw new Error('SPORTMONKS_API_KEY is not configured');
    return { Authorization: apiKey };
  }

  private async get<T>(path: string): Promise<T[]> {
    const response = await this.client.getJson<SmPaginated<T>>(path, {
      headers: this.headers(),
      allowMissing: true,
    });
    return response?.data ?? [];
  }

  override async getCompetitions(): Promise<ProviderCompetition[]> {
    const leagues = await this.get<SmLeague>('leagues');
    return leagues.map((league) => ({
      externalId: String(league.id),
      name: league.name,
      type: league.type === 'cup' ? 'CUP' : 'LEAGUE',
    }));
  }

  override async getSeasons(competitionExternalId: string): Promise<ProviderSeason[]> {
    const seasons = await this.get<SmSeason>(`seasons?filters=leagueId:${competitionExternalId}`);
    return seasons.map((season) => ({
      externalId: String(season.id),
      competitionExternalId,
      name: season.name,
      startDate: season.starting_at ?? null,
      endDate: season.ending_at ?? null,
    }));
  }

  override async getTeams(params: TeamQuery = {}): Promise<ProviderTeam[]> {
    const path = params.seasonExternalId
      ? `teams/seasons/${params.seasonExternalId}`
      : 'teams';
    const teams = await this.get<SmTeam>(path);

    return teams.map((team) => ({
      externalId: String(team.id),
      name: team.name,
      shortName: team.short_code ?? null,
      founded: team.founded ?? null,
    }));
  }

  override async getPlayers(params: PlayerQuery = {}): Promise<ProviderPlayer[]> {
    const path = params.teamExternalId ? `squads/teams/${params.teamExternalId}` : 'players';
    const players = await this.get<SmPlayer>(path);

    return players.map((player) => {
      const fullName =
        player.display_name ?? `${player.firstname ?? ''} ${player.lastname ?? ''}`.trim();
      return {
        externalId: String(player.id),
        firstName: player.firstname ?? fullName,
        lastName: player.lastname ?? '',
        fullName,
        dateOfBirth: player.date_of_birth ?? null,
        heightCm: player.height ?? null,
        weightKg: player.weight ?? null,
        position: player.position?.name ?? null,
        teamExternalId: params.teamExternalId ?? null,
      };
    });
  }

  override async getMatches(params: MatchQuery = {}): Promise<ProviderMatch[]> {
    if (!params.seasonExternalId) {
      throw new Error('Sportmonks requires seasonExternalId to list fixtures');
    }

    const fixtures = await this.get<SmFixture>(
      `fixtures?filters=fixtureSeasons:${params.seasonExternalId}&include=participants;scores`,
    );

    return fixtures.slice(0, params.limit ?? fixtures.length).map((fixture) => {
      const home = fixture.participants?.find((team) => team.meta?.location === 'home');
      const away = fixture.participants?.find((team) => team.meta?.location === 'away');

      const goalsFor = (location: string): number | null => {
        const entry = fixture.scores?.find(
          (score) => score.description === 'CURRENT' && score.score?.participant === location,
        );
        return entry?.score?.goals ?? null;
      };

      return {
        externalId: String(fixture.id),
        competitionExternalId: String(fixture.league_id),
        seasonExternalId: String(fixture.season_id),
        homeTeamExternalId: String(home?.id ?? ''),
        awayTeamExternalId: String(away?.id ?? ''),
        kickoffAt: fixture.starting_at,
        homeScore: goalsFor('home'),
        awayScore: goalsFor('away'),
      };
    });
  }
}
