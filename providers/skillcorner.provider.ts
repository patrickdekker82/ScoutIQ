import { CoordinateSystem, ProviderKind } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { SourceClient } from '@/providers/fetch-client';
import {
  BaseProvider,
  type MatchQuery,
  type ProviderCapabilities,
  type ProviderLicence,
  type ProviderMatch,
  type ProviderPlayer,
  type ProviderTeam,
  type ProviderTrackingFrame,
  type PlayerQuery,
  type TeamQuery,
} from '@/providers/types';

/**
 * SkillCorner Open Data importer (§15).
 *
 * Layout of the public dataset:
 *   matches.json
 *   matches/{id}/match_data.json
 *   matches/{id}/structured_data.json   (tracking frames, 10 FPS)
 *
 * SkillCorner uses metres with the origin at the CENTRE of the pitch
 * (x: -52.5..52.5, y: -34..34), so the frames are shifted into ScoutIQ's
 * bottom-left origin here before the standard transformation runs.
 */

interface ScTeam {
  id: number;
  name: string;
  short_name?: string;
}

interface ScPlayer {
  id?: number;
  trackable_object?: number;
  player_role?: { name?: string; acronym?: string };
  team_id?: number;
  number?: number;
  first_name?: string;
  last_name?: string;
  birthday?: string;
}

interface ScMatchData {
  id: number;
  date_time: string;
  home_team: ScTeam;
  away_team: ScTeam;
  home_team_score?: number;
  away_team_score?: number;
  competition?: { id: number; name: string };
  season?: { id: number; name: string };
  stadium?: { name: string };
  players?: ScPlayer[];
  pitch_length?: number;
  pitch_width?: number;
}

interface ScFrame {
  frame: number;
  timestamp: string | null;
  period: number | null;
  possession?: { group?: string | null; trackable_object?: number | null } | null;
  data: {
    trackable_object?: number;
    track_id?: number;
    group_name?: string;
    x: number;
    y: number;
    z?: number;
  }[];
}

const HALF_LENGTH = 52.5;
const HALF_WIDTH = 34;

const timestampToMs = (timestamp: string | null): number => {
  if (!timestamp) return 0;
  const [hours = '0', minutes = '0', seconds = '0'] = timestamp.split(':');
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
};

export class SkillCornerProvider extends BaseProvider {
  readonly key = 'skillcorner-open';
  readonly name = 'SkillCorner Open Data';
  readonly kind = ProviderKind.OPEN_DATA;
  readonly version = 'opendata-v1';
  /** Frames are pre-shifted to a 105x68 bottom-left origin by this importer. */
  readonly coordinateSystem = CoordinateSystem.CANONICAL_105_68;

  readonly licence: ProviderLicence = {
    name: 'SkillCorner Open Data Licence',
    url: 'https://github.com/SkillCorner/opendata',
    notes:
      'Released for research and education. Commercial use and redistribution ' +
      'are not granted by default - confirm terms with SkillCorner before any ' +
      'commercial application.',
    commercialUseAllowed: false,
    redistributionAllowed: false,
    attributionRequired: true,
  };

  readonly capabilities: ProviderCapabilities = {
    competitions: false,
    seasons: false,
    teams: true,
    players: true,
    matches: true,
    events: false,
    lineups: false,
    playerStats: false,
    teamStats: false,
    tracking: true,
  };

  private readonly client: SourceClient;
  private readonly matchCache = new Map<string, ScMatchData>();

  constructor() {
    super();
    const { skillcorner } = getConfig().providers;
    this.client = new SourceClient(skillcorner.baseUrl, skillcorner.localPath);
  }

  override isConfigured(): boolean {
    return getConfig().providers.skillcorner.enabled;
  }

  private async matchData(matchExternalId: string): Promise<ScMatchData | null> {
    const cached = this.matchCache.get(matchExternalId);
    if (cached) return cached;

    const data = await this.client.getJson<ScMatchData>(
      `matches/${matchExternalId}/match_data.json`,
      { allowMissing: true },
    );
    if (data) this.matchCache.set(matchExternalId, data);
    return data;
  }

  private async matchIndex(): Promise<ScMatchData[]> {
    return (await this.client.getJson<ScMatchData[]>('matches.json', { allowMissing: true })) ?? [];
  }

  override async getMatches(params: MatchQuery = {}): Promise<ProviderMatch[]> {
    const matches = await this.matchIndex();

    return matches
      .filter((match) => !params.since || new Date(match.date_time) >= params.since)
      .slice(0, params.limit ?? matches.length)
      .map((match) => ({
        externalId: String(match.id),
        competitionExternalId: String(match.competition?.id ?? 'skillcorner-open'),
        seasonExternalId: String(match.season?.id ?? 'open'),
        homeTeamExternalId: String(match.home_team.id),
        awayTeamExternalId: String(match.away_team.id),
        kickoffAt: match.date_time,
        homeScore: match.home_team_score ?? null,
        awayScore: match.away_team_score ?? null,
        venue: match.stadium?.name ?? null,
      }));
  }

  override async getTeams(_params: TeamQuery = {}): Promise<ProviderTeam[]> {
    const matches = await this.matchIndex();
    const teams = new Map<string, ProviderTeam>();

    for (const match of matches) {
      for (const team of [match.home_team, match.away_team]) {
        teams.set(String(team.id), {
          externalId: String(team.id),
          name: team.name,
          shortName: team.short_name ?? null,
        });
      }
    }

    return [...teams.values()];
  }

  override async getPlayers(params: PlayerQuery = {}): Promise<ProviderPlayer[]> {
    const matches = await this.matchIndex();
    const players = new Map<string, ProviderPlayer>();

    for (const summary of matches) {
      const data = await this.matchData(String(summary.id));
      for (const player of data?.players ?? []) {
        const externalId = String(player.id ?? player.trackable_object ?? '');
        if (!externalId || players.has(externalId)) continue;

        const firstName = player.first_name ?? '';
        const lastName = player.last_name ?? '';
        const fullName = `${firstName} ${lastName}`.trim() || `Player ${externalId}`;
        const teamExternalId = player.team_id ? String(player.team_id) : null;
        if (params.teamExternalId && params.teamExternalId !== teamExternalId) continue;

        players.set(externalId, {
          externalId,
          firstName: firstName || fullName,
          lastName: lastName || fullName,
          fullName,
          dateOfBirth: player.birthday ?? null,
          position: player.player_role?.acronym ?? player.player_role?.name ?? null,
          teamExternalId,
        });
      }
    }

    return [...players.values()];
  }

  /**
   * Tracking frames at 10 FPS.
   *
   * Returned as a stream-friendly array; the import pipeline downsamples and
   * aggregates before anything reaches the database or the browser (§59).
   */
  override async getTrackingData(matchExternalId: string): Promise<ProviderTrackingFrame[]> {
    const [data, frames] = await Promise.all([
      this.matchData(matchExternalId),
      this.client.getJson<ScFrame[]>(`matches/${matchExternalId}/structured_data.json`, {
        allowMissing: true,
      }),
    ]);

    if (!frames) return [];

    const teamOf = new Map<number, string>();
    for (const player of data?.players ?? []) {
      const trackable = player.trackable_object ?? player.id;
      if (trackable && player.team_id) teamOf.set(trackable, String(player.team_id));
    }

    const playerOf = new Map<number, string>();
    for (const player of data?.players ?? []) {
      const trackable = player.trackable_object ?? player.id;
      if (trackable) playerOf.set(trackable, String(player.id ?? trackable));
    }

    const homeTeamId = data ? String(data.home_team.id) : null;
    const awayTeamId = data ? String(data.away_team.id) : null;

    return frames.map((frame) => {
      const ball = frame.data.find((entry) => entry.group_name === 'ball' || entry.trackable_object === 55);

      return {
        matchExternalId,
        frameIndex: frame.frame,
        timestampMs: timestampToMs(frame.timestamp),
        period: frame.period ?? 1,
        ballInPlay: Boolean(frame.timestamp),
        possessionTeamExternalId:
          frame.possession?.group === 'home team'
            ? homeTeamId
            : frame.possession?.group === 'away team'
              ? awayTeamId
              : null,
        ball: ball ? { x: ball.x + HALF_LENGTH, y: ball.y + HALF_WIDTH, z: ball.z ?? null } : null,
        players: frame.data
          .filter((entry) => entry.trackable_object && entry.trackable_object !== 55)
          .map((entry) => ({
            playerExternalId: playerOf.get(entry.trackable_object as number) ?? null,
            teamExternalId: teamOf.get(entry.trackable_object as number) ?? null,
            // Centre origin -> bottom-left origin.
            x: entry.x + HALF_LENGTH,
            y: entry.y + HALF_WIDTH,
          })),
      };
    });
  }
}
