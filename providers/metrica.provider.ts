import { CoordinateSystem, ProviderKind } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { SourceClient } from '@/providers/fetch-client';
import {
  BaseProvider,
  type MatchQuery,
  type ProviderCapabilities,
  type ProviderEvent,
  type ProviderLicence,
  type ProviderMatch,
  type ProviderTrackingFrame,
} from '@/providers/types';

/**
 * Metrica Sports sample data importer (§16).
 *
 * Metrica publishes synchronised tracking AND event data for a handful of
 * matches, which makes it the reference dataset for validating that ScoutIQ's
 * own metrics agree with the events they claim to describe.
 *
 * Coordinates are normalised 0..1 with the origin top-left (§33 handles it).
 *
 * The sample repository is CSV for games 1-2 and JSON for game 3. This
 * importer reads the JSON form; CSV games are handled by the generic CSV
 * provider, which is why `getTrackingData` returns an empty list rather than
 * throwing when only CSV is available.
 */

interface MetricaJsonEvent {
  index?: number;
  team?: string;
  type?: { name?: string } | string;
  subtype?: { name?: string } | string | null;
  period?: number;
  start?: { frame?: number; time?: number; x?: number | null; y?: number | null };
  end?: { frame?: number; time?: number; x?: number | null; y?: number | null };
  from?: { id?: string; name?: string } | string | null;
  to?: { id?: string; name?: string } | string | null;
}

interface MetricaJsonFrame {
  frameIdx: number;
  period: number;
  time: number;
  ball?: { xyz?: [number, number, number] | null } | null;
  homePlayers?: { playerId: string; xyz: [number, number, number?] }[];
  awayPlayers?: { playerId: string; xyz: [number, number, number?] }[];
}

const TYPE_MAP: Record<string, string> = {
  PASS: 'PASS',
  SHOT: 'SHOT',
  CARRY: 'CARRY',
  DRIBBLE: 'DRIBBLE',
  CHALLENGE: 'DUEL',
  RECOVERY: 'RECOVERY',
  BALL_LOST: 'DISPOSSESSED',
  BALL_OUT: 'OTHER',
  SET_PIECE: 'SET_PIECE',
  FAULT_RECEIVED: 'FOUL',
  CARD: 'CARD',
};

const nameOf = (value: { name?: string } | string | null | undefined): string =>
  typeof value === 'string' ? value : (value?.name ?? '');

export class MetricaProvider extends BaseProvider {
  readonly key = 'metrica-sample';
  readonly name = 'Metrica Sports Sample Data';
  readonly kind = ProviderKind.OPEN_DATA;
  readonly version = 'sample-data-v1';
  readonly coordinateSystem = CoordinateSystem.METRICA_0_1;

  readonly licence: ProviderLicence = {
    name: 'Metrica Sports Sample Data Licence',
    url: 'https://github.com/metrica-sports/sample-data',
    notes:
      'Sample data published for research and development. Treat as ' +
      'non-commercial unless Metrica Sports states otherwise.',
    commercialUseAllowed: false,
    redistributionAllowed: false,
    attributionRequired: true,
  };

  readonly capabilities: ProviderCapabilities = {
    competitions: false,
    seasons: false,
    teams: false,
    players: false,
    matches: true,
    events: true,
    lineups: false,
    playerStats: false,
    teamStats: false,
    tracking: true,
  };

  private readonly client: SourceClient;

  /** The sample repository exposes a fixed set of games. */
  private static readonly GAMES = ['1', '2', '3'];

  constructor() {
    super();
    const { metrica } = getConfig().providers;
    this.client = new SourceClient(metrica.baseUrl, metrica.localPath);
  }

  override isConfigured(): boolean {
    return getConfig().providers.metrica.enabled;
  }

  override async getMatches(params: MatchQuery = {}): Promise<ProviderMatch[]> {
    return MetricaProvider.GAMES.slice(0, params.limit ?? MetricaProvider.GAMES.length).map(
      (game) => ({
        externalId: `metrica-game-${game}`,
        competitionExternalId: 'metrica-sample',
        seasonExternalId: 'sample',
        homeTeamExternalId: `metrica-${game}-home`,
        awayTeamExternalId: `metrica-${game}-away`,
        kickoffAt: new Date(Date.UTC(2019, 0, Number(game), 15, 0)).toISOString(),
      }),
    );
  }

  private gameNumber(matchExternalId: string): string {
    return matchExternalId.replace('metrica-game-', '');
  }

  override async getEvents(matchExternalId: string): Promise<ProviderEvent[]> {
    const game = this.gameNumber(matchExternalId);
    const payload = await this.client.getJson<{ data?: MetricaJsonEvent[] } | MetricaJsonEvent[]>(
      `Sample_Game_${game}/Sample_Game_${game}_events.json`,
      { allowMissing: true },
    );
    if (!payload) return [];

    const rows = Array.isArray(payload) ? payload : (payload.data ?? []);

    return rows.map((row, index) => {
      const rawType = nameOf(row.type).toUpperCase().replace(/\s+/g, '_');
      const seconds = row.start?.time ?? 0;

      return {
        externalId: `${matchExternalId}-${row.index ?? index}`,
        matchExternalId,
        teamExternalId: row.team ? `metrica-${game}-${row.team.toLowerCase()}` : null,
        playerExternalId: playerIdOf(row.from, game),
        type: TYPE_MAP[rawType] ?? 'OTHER',
        subType: nameOf(row.subtype) || null,
        minute: Math.floor(seconds / 60),
        second: Math.floor(seconds % 60),
        period: row.period ?? 1,
        timestampMs: Math.round(seconds * 1000),
        x: row.start?.x ?? null,
        y: row.start?.y ?? null,
        endX: row.end?.x ?? null,
        endY: row.end?.y ?? null,
        outcome: null,
        detail: {
          pass: TYPE_MAP[rawType] === 'PASS'
            ? { recipientExternalId: playerIdOf(row.to, game), completed: Boolean(row.to) }
            : undefined,
        },
      };
    });
  }

  override async getTrackingData(matchExternalId: string): Promise<ProviderTrackingFrame[]> {
    const game = this.gameNumber(matchExternalId);
    const frames = await this.client.getJson<MetricaJsonFrame[]>(
      `Sample_Game_${game}/Sample_Game_${game}_tracking.json`,
      { allowMissing: true },
    );
    // Games shipped only as CSV return nothing here rather than failing the
    // import; use the CSV provider for those.
    if (!frames) return [];

    return frames.map((frame) => ({
      matchExternalId,
      frameIndex: frame.frameIdx,
      timestampMs: Math.round((frame.time ?? 0) * 1000),
      period: frame.period ?? 1,
      ballInPlay: Boolean(frame.ball?.xyz),
      ball: frame.ball?.xyz
        ? { x: frame.ball.xyz[0], y: frame.ball.xyz[1], z: frame.ball.xyz[2] ?? null }
        : null,
      players: [
        ...(frame.homePlayers ?? []).map((player) => ({
          playerExternalId: `metrica-${game}-home-${player.playerId}`,
          teamExternalId: `metrica-${game}-home`,
          x: player.xyz[0],
          y: player.xyz[1],
        })),
        ...(frame.awayPlayers ?? []).map((player) => ({
          playerExternalId: `metrica-${game}-away-${player.playerId}`,
          teamExternalId: `metrica-${game}-away`,
          x: player.xyz[0],
          y: player.xyz[1],
        })),
      ],
    }));
  }
}

function playerIdOf(
  value: { id?: string; name?: string } | string | null | undefined,
  game: string,
): string | null {
  const name = typeof value === 'string' ? value : (value?.id ?? value?.name);
  if (!name) return null;
  const side = name.toLowerCase().startsWith('away') ? 'away' : 'home';
  return `metrica-${game}-${side}-${name}`;
}
