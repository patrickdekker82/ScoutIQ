import { CoordinateSystem, ProviderKind } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { SourceClient } from '@/providers/fetch-client';
import {
  BaseProvider,
  type ProviderCapabilities,
  type ProviderCompetition,
  type ProviderEvent,
  type ProviderLicence,
  type ProviderLineup,
  type ProviderLineupPlayer,
  type ProviderMatch,
  type ProviderPlayer,
  type ProviderSeason,
  type ProviderTeam,
  type MatchQuery,
  type PlayerQuery,
  type TeamQuery,
} from '@/providers/types';

/**
 * StatsBomb Open Data importer (§14).
 *
 * Reads the public open-data repository layout:
 *   competitions.json
 *   matches/{competition_id}/{season_id}.json
 *   lineups/{match_id}.json
 *   events/{match_id}.json
 *   three-sixty/{match_id}.json
 *
 * StatsBomb coordinates are 120x80 with the origin top-left; the pipeline
 * converts them to canonical metres (§33).
 */

interface SbCompetition {
  competition_id: number;
  season_id: number;
  country_name: string;
  competition_name: string;
  competition_gender: string;
  competition_youth?: boolean;
  competition_international?: boolean;
  season_name: string;
}

interface SbMatch {
  match_id: number;
  match_date: string;
  kick_off: string | null;
  competition: { competition_id: number; competition_name: string; country_name: string };
  season: { season_id: number; season_name: string };
  home_team: { home_team_id: number; home_team_name: string; country?: { name: string } };
  away_team: { away_team_id: number; away_team_name: string; country?: { name: string } };
  home_score: number | null;
  away_score: number | null;
  match_week?: number | null;
  competition_stage?: { name: string } | null;
  stadium?: { name: string } | null;
  referee?: { name: string } | null;
}

interface SbLineupPlayer {
  player_id: number;
  player_name: string;
  player_nickname: string | null;
  jersey_number: number | null;
  country?: { name: string } | null;
  positions?: { position: string; from: string; to: string | null; start_reason: string }[];
}

interface SbLineup {
  team_id: number;
  team_name: string;
  lineup: SbLineupPlayer[];
  formation?: number;
}

interface SbEvent {
  id: string;
  index: number;
  period: number;
  timestamp: string;
  minute: number;
  second: number;
  type: { id: number; name: string };
  possession?: number;
  possession_team?: { id: number; name: string };
  play_pattern?: { name: string };
  team?: { id: number; name: string };
  player?: { id: number; name: string };
  position?: { name: string };
  location?: [number, number];
  duration?: number;
  under_pressure?: boolean;
  pass?: {
    recipient?: { id: number; name: string };
    length?: number;
    angle?: number;
    height?: { name: string };
    end_location?: [number, number];
    body_part?: { name: string };
    type?: { name: string };
    outcome?: { name: string };
    cross?: boolean;
    switch?: boolean;
    through_ball?: boolean;
    cut_back?: boolean;
    shot_assist?: boolean;
    goal_assist?: boolean;
    technique?: { name: string };
  };
  shot?: {
    statsbomb_xg?: number;
    end_location?: number[];
    outcome?: { name: string };
    body_part?: { name: string };
    technique?: { name: string };
    type?: { name: string };
    first_time?: boolean;
  };
  carry?: { end_location?: [number, number] };
  dribble?: { outcome?: { name: string }; nutmeg?: boolean; overrun?: boolean };
  duel?: { type?: { name: string }; outcome?: { name: string } };
  foul_committed?: { advantage?: boolean; penalty?: boolean; card?: { name: string } };
  interception?: { outcome?: { name: string } };
  clearance?: { body_part?: { name: string } };
  ball_recovery?: { recovery_failure?: boolean };
  counterpress?: boolean;
  substitution?: { replacement?: { id: number; name: string } };
}

const TYPE_MAP: Record<string, string> = {
  Pass: 'PASS',
  Shot: 'SHOT',
  Carry: 'CARRY',
  Dribble: 'DRIBBLE',
  Duel: 'DUEL',
  Pressure: 'PRESSURE',
  'Ball Recovery': 'RECOVERY',
  Interception: 'INTERCEPTION',
  Clearance: 'CLEARANCE',
  Block: 'BLOCK',
  'Foul Committed': 'FOUL',
  'Foul Won': 'FOUL',
  Substitution: 'SUBSTITUTION',
  'Half Start': 'HALF_START',
  'Half End': 'HALF_END',
  'Goal Keeper': 'GOALKEEPER',
  Miscontrol: 'MISCONTROL',
  Dispossessed: 'DISPOSSESSED',
  'Own Goal Against': 'GOAL',
  'Own Goal For': 'GOAL',
  Offside: 'OFFSIDE',
};

const timestampToMs = (timestamp: string): number => {
  const [hours = '0', minutes = '0', rest = '0'] = timestamp.split(':');
  const [seconds = '0', millis = '0'] = rest.split('.');
  return (
    Number(hours) * 3_600_000 +
    Number(minutes) * 60_000 +
    Number(seconds) * 1000 +
    Number(millis.padEnd(3, '0'))
  );
};

const BODY_PARTS: Record<string, string> = {
  'Right Foot': 'RIGHT_FOOT',
  'Left Foot': 'LEFT_FOOT',
  Head: 'HEAD',
  Other: 'OTHER',
  'Drop Kick': 'OTHER',
  'Keeper Arm': 'OTHER',
};

export class StatsBombProvider extends BaseProvider {
  readonly key = 'statsbomb-open';
  readonly name = 'StatsBomb Open Data';
  readonly kind = ProviderKind.OPEN_DATA;
  readonly version = 'open-data-v1';
  readonly coordinateSystem = CoordinateSystem.STATSBOMB_120_80;

  readonly licence: ProviderLicence = {
    name: 'StatsBomb Open Data Licence',
    url: 'https://github.com/statsbomb/open-data/blob/master/LICENSE.pdf',
    notes:
      'Free for research and education with attribution. Commercial use and ' +
      'redistribution require permission from StatsBomb - open access is not ' +
      'a commercial licence.',
    commercialUseAllowed: false,
    redistributionAllowed: false,
    attributionRequired: true,
  };

  readonly capabilities: ProviderCapabilities = {
    competitions: true,
    seasons: true,
    teams: true,
    players: true,
    matches: true,
    events: true,
    lineups: true,
    playerStats: false,
    teamStats: false,
    tracking: false,
  };

  private readonly client: SourceClient;
  private competitionCache: SbCompetition[] | null = null;

  constructor() {
    super();
    const { statsbomb } = getConfig().providers;
    this.client = new SourceClient(statsbomb.baseUrl, statsbomb.localPath);
  }

  override isConfigured(): boolean {
    return getConfig().providers.statsbomb.enabled;
  }

  private async competitions(): Promise<SbCompetition[]> {
    this.competitionCache ??= (await this.client.getJson<SbCompetition[]>('competitions.json')) ?? [];
    return this.competitionCache;
  }

  override async getCompetitions(): Promise<ProviderCompetition[]> {
    const rows = await this.competitions();
    const seen = new Map<string, ProviderCompetition>();

    for (const row of rows) {
      const externalId = String(row.competition_id);
      if (seen.has(externalId)) continue;
      seen.set(externalId, {
        externalId,
        name: row.competition_name,
        country: row.country_name,
        tier: 1,
        type: row.competition_international ? 'INTERNATIONAL' : 'LEAGUE',
        gender: row.competition_gender === 'female' ? 'FEMALE' : 'MALE',
      });
    }

    return [...seen.values()];
  }

  override async getSeasons(competitionExternalId: string): Promise<ProviderSeason[]> {
    const rows = await this.competitions();
    return rows
      .filter((row) => String(row.competition_id) === competitionExternalId)
      .map((row) => ({
        externalId: String(row.season_id),
        competitionExternalId,
        name: row.season_name,
      }));
  }

  private async matchesFor(competitionId: string, seasonId: string): Promise<SbMatch[]> {
    return (
      (await this.client.getJson<SbMatch[]>(`matches/${competitionId}/${seasonId}.json`, {
        allowMissing: true,
      })) ?? []
    );
  }

  override async getMatches(params: MatchQuery = {}): Promise<ProviderMatch[]> {
    const { competitionExternalId, seasonExternalId } = params;
    if (!competitionExternalId || !seasonExternalId) {
      throw new Error('StatsBomb requires competitionExternalId and seasonExternalId');
    }

    const matches = await this.matchesFor(competitionExternalId, seasonExternalId);

    return matches
      .filter((match) => !params.since || new Date(match.match_date) >= params.since)
      .slice(0, params.limit ?? matches.length)
      .map((match) => ({
        externalId: String(match.match_id),
        competitionExternalId,
        seasonExternalId,
        homeTeamExternalId: String(match.home_team.home_team_id),
        awayTeamExternalId: String(match.away_team.away_team_id),
        kickoffAt: `${match.match_date}T${match.kick_off ?? '00:00:00.000'}`,
        homeScore: match.home_score,
        awayScore: match.away_score,
        venue: match.stadium?.name ?? null,
        matchweek: match.match_week ?? null,
        stage: match.competition_stage?.name ?? null,
        referee: match.referee?.name ?? null,
      }));
  }

  override async getTeams(params: TeamQuery = {}): Promise<ProviderTeam[]> {
    const { competitionExternalId, seasonExternalId } = params;
    if (!competitionExternalId || !seasonExternalId) {
      throw new Error('StatsBomb requires competitionExternalId and seasonExternalId');
    }

    const matches = await this.matchesFor(competitionExternalId, seasonExternalId);
    const teams = new Map<string, ProviderTeam>();

    for (const match of matches) {
      teams.set(String(match.home_team.home_team_id), {
        externalId: String(match.home_team.home_team_id),
        name: match.home_team.home_team_name,
        country: match.home_team.country?.name ?? match.competition.country_name,
      });
      teams.set(String(match.away_team.away_team_id), {
        externalId: String(match.away_team.away_team_id),
        name: match.away_team.away_team_name,
        country: match.away_team.country?.name ?? match.competition.country_name,
      });
    }

    return [...teams.values()];
  }

  /**
   * Players come from lineups: the open data has no standalone player index,
   * so this walks the matches of a season.
   */
  override async getPlayers(params: PlayerQuery = {}): Promise<ProviderPlayer[]> {
    const { competitionExternalId, seasonExternalId } = params;
    if (!competitionExternalId || !seasonExternalId) {
      throw new Error('StatsBomb requires competitionExternalId and seasonExternalId');
    }

    const matches = await this.matchesFor(competitionExternalId, seasonExternalId);
    const players = new Map<string, ProviderPlayer>();

    for (const match of matches) {
      const lineups =
        (await this.client.getJson<SbLineup[]>(`lineups/${match.match_id}.json`, {
          allowMissing: true,
        })) ?? [];

      for (const lineup of lineups) {
        const teamExternalId = String(lineup.team_id);
        if (params.teamExternalId && params.teamExternalId !== teamExternalId) continue;

        for (const entry of lineup.lineup) {
          const externalId = String(entry.player_id);
          if (players.has(externalId)) continue;

          const [firstName = entry.player_name, ...rest] = entry.player_name.split(' ');
          players.set(externalId, {
            externalId,
            firstName,
            lastName: rest.join(' ') || firstName,
            fullName: entry.player_name,
            knownAs: entry.player_nickname,
            nationality: entry.country?.name ?? null,
            position: entry.positions?.[0]?.position ?? null,
            teamExternalId,
          });
        }
      }
    }

    return [...players.values()];
  }

  override async getLineups(matchExternalId: string): Promise<ProviderLineup[]> {
    const lineups =
      (await this.client.getJson<SbLineup[]>(`lineups/${matchExternalId}.json`, {
        allowMissing: true,
      })) ?? [];

    return lineups.map((lineup) => {
      const players: ProviderLineupPlayer[] = lineup.lineup.map((entry) => {
        const first = entry.positions?.[0];
        return {
          playerExternalId: String(entry.player_id),
          teamExternalId: String(lineup.team_id),
          position: first?.position ?? null,
          shirtNumber: entry.jersey_number,
          isStarter: first?.start_reason === 'Starting XI',
          minutesPlayed: minutesFromPositions(entry.positions),
        };
      });

      return {
        matchExternalId,
        teamExternalId: String(lineup.team_id),
        formation: lineup.formation ? String(lineup.formation) : null,
        players,
      };
    });
  }

  override async getEvents(matchExternalId: string): Promise<ProviderEvent[]> {
    const events =
      (await this.client.getJson<SbEvent[]>(`events/${matchExternalId}.json`, {
        allowMissing: true,
      })) ?? [];

    return events.map((event) => this.mapEvent(event, matchExternalId));
  }

  private mapEvent(event: SbEvent, matchExternalId: string): ProviderEvent {
    const type = TYPE_MAP[event.type.name] ?? 'OTHER';
    const detail: Record<string, unknown> = {};

    if (event.pass) {
      const outcome = event.pass.outcome?.name;
      detail.pass = {
        recipientExternalId: event.pass.recipient ? String(event.pass.recipient.id) : null,
        lengthM: event.pass.length ?? 0,
        angleRad: event.pass.angle ?? 0,
        height: (event.pass.height?.name ?? '').toUpperCase().replace(' PASS', '') || 'UNKNOWN',
        bodyPart: BODY_PARTS[event.pass.body_part?.name ?? ''] ?? 'UNKNOWN',
        technique: event.pass.technique?.name ?? null,
        // In StatsBomb an absent outcome means the pass was completed.
        completed: !outcome,
        isCross: Boolean(event.pass.cross),
        isSwitch: Boolean(event.pass.switch),
        isThroughBall: event.pass.technique?.name === 'Through Ball',
        isCutback: Boolean(event.pass.cut_back),
        isKeyPass: Boolean(event.pass.shot_assist) || Boolean(event.pass.goal_assist),
        isAssist: Boolean(event.pass.goal_assist),
      };
    }

    if (event.shot) {
      const outcome = event.shot.outcome?.name ?? '';
      detail.shot = {
        xg: event.shot.statsbomb_xg ?? 0,
        providerXg: event.shot.statsbomb_xg ?? null,
        bodyPart: BODY_PARTS[event.shot.body_part?.name ?? ''] ?? 'UNKNOWN',
        technique: event.shot.technique?.name ?? null,
        firstTime: Boolean(event.shot.first_time),
        isPenalty: event.shot.type?.name === 'Penalty',
        isSetPiece: ['Free Kick', 'Corner', 'Penalty'].includes(event.shot.type?.name ?? ''),
        isGoal: outcome === 'Goal',
        onTarget: ['Goal', 'Saved', 'Saved to Post'].includes(outcome),
        blocked: outcome === 'Blocked',
        endX: event.shot.end_location?.[0] ?? null,
        endY: event.shot.end_location?.[1] ?? null,
        endZ: event.shot.end_location?.[2] ?? null,
      };
    }

    if (event.dribble) {
      detail.dribble = {
        completed: event.dribble.outcome?.name === 'Complete',
        nutmeg: Boolean(event.dribble.nutmeg),
        overrun: Boolean(event.dribble.overrun),
      };
    }

    if (event.duel) {
      const duelType = event.duel.type?.name ?? '';
      detail.duel = {
        duelType: duelType.includes('Aerial') ? 'AERIAL' : duelType.includes('Tackle') ? 'TACKLE' : 'GROUND',
        won: (event.duel.outcome?.name ?? '').includes('Won') ||
          (event.duel.outcome?.name ?? '').includes('Success'),
      };
    }

    if (event.foul_committed) {
      detail.foul = {
        committed: true,
        advantage: Boolean(event.foul_committed.advantage),
        penalty: Boolean(event.foul_committed.penalty),
      };
      if (event.foul_committed.card) {
        detail.card = {
          cardType: event.foul_committed.card.name === 'Yellow Card' ? 'YELLOW' : 'RED',
        };
      }
    }

    if (event.ball_recovery) {
      detail.recovery = { failed: Boolean(event.ball_recovery.recovery_failure) };
    }

    if (event.type.name === 'Pressure') {
      detail.pressure = {
        durationSec: event.duration ?? 0,
        counterpress: Boolean(event.counterpress),
      };
    }

    if (event.clearance) {
      detail.clearance = {
        bodyPart: BODY_PARTS[event.clearance.body_part?.name ?? ''] ?? 'UNKNOWN',
      };
    }

    if (event.substitution) {
      detail.substitution = {
        replacementExternalId: event.substitution.replacement
          ? String(event.substitution.replacement.id)
          : null,
      };
    }

    const endLocation = event.pass?.end_location ?? event.carry?.end_location ?? null;

    return {
      externalId: event.id,
      matchExternalId,
      teamExternalId: event.team ? String(event.team.id) : null,
      playerExternalId: event.player ? String(event.player.id) : null,
      possessionTeamExternalId: event.possession_team ? String(event.possession_team.id) : null,
      type,
      subType: event.type.name,
      minute: event.minute,
      second: event.second,
      period: event.period,
      timestampMs: timestampToMs(event.timestamp),
      x: event.location?.[0] ?? null,
      y: event.location?.[1] ?? null,
      endX: endLocation?.[0] ?? null,
      endY: endLocation?.[1] ?? null,
      outcome:
        event.pass?.outcome?.name ??
        event.shot?.outcome?.name ??
        event.dribble?.outcome?.name ??
        event.duel?.outcome?.name ??
        null,
      underPressure: Boolean(event.under_pressure),
      durationSec: event.duration ?? null,
      playPattern: event.play_pattern?.name ?? null,
      possessionId: event.possession ?? null,
      detail,
    };
  }
}

/** StatsBomb records position spells; the last `to` gives the minutes played. */
function minutesFromPositions(
  positions: SbLineupPlayer['positions'],
): number | null {
  if (!positions || positions.length === 0) return null;

  const toMinutes = (value: string): number => {
    const [hours = '0', minutes = '0'] = value.split(':');
    return Number(hours) * 60 + Number(minutes);
  };

  const first = positions[0];
  const last = positions[positions.length - 1];
  if (!first || !last) return null;

  const start = toMinutes(first.from);
  const end = last.to ? toMinutes(last.to) : 90;
  return Math.max(0, Math.round(end - start));
}
