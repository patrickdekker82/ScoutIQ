import { CoordinateSystem, ProviderKind } from '@prisma/client';
import { getStorage } from '@/lib/storage';
import {
  BaseProvider,
  type ProviderCapabilities,
  type ProviderEvent,
  type ProviderLicence,
  type ProviderMatch,
  type ProviderPlayer,
  type ProviderTeam,
} from '@/providers/types';

/**
 * Generic CSV/JSON provider (§12, §55).
 *
 * Reads files dropped into `<RAW_DATA_ROOT>/inbox`. This is the escape hatch
 * that keeps ScoutIQ useful for data no integration exists for - a scout's
 * own spreadsheet, an export from another tool, a one-off dump.
 *
 * JSON files use the canonical provider shapes. CSV files are parsed with a
 * header row and mapped by column name.
 */

export interface CsvJsonPayload {
  teams?: ProviderTeam[];
  players?: ProviderPlayer[];
  matches?: ProviderMatch[];
  events?: ProviderEvent[];
}

/**
 * Minimal RFC4180 CSV parser: quoted fields, escaped quotes, embedded commas
 * and newlines. Small enough to own, and avoids a dependency for one job.
 */
export function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
  if (!header) return [];

  return body.map((entry) => {
    const record: Record<string, string> = {};
    header.forEach((column, index) => {
      record[column.trim()] = (entry[index] ?? '').trim();
    });
    return record;
  });
}

const numeric = (value: string | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class CsvJsonProvider extends BaseProvider {
  readonly key = 'csv-json';
  readonly name = 'CSV / JSON file import';
  readonly kind = ProviderKind.FILE_IMPORT;
  readonly version = 'v1';
  readonly coordinateSystem = CoordinateSystem.CANONICAL_105_68;

  readonly licence: ProviderLicence = {
    name: 'User supplied',
    notes:
      'Licensing of uploaded files is the responsibility of whoever uploads ' +
      'them. ScoutIQ makes no claim about their redistribution rights.',
    commercialUseAllowed: false,
    redistributionAllowed: false,
    attributionRequired: false,
  };

  readonly capabilities: ProviderCapabilities = {
    competitions: false,
    seasons: false,
    teams: true,
    players: true,
    matches: true,
    events: true,
    lineups: false,
    playerStats: false,
    teamStats: false,
    tracking: false,
  };

  private cache: CsvJsonPayload | null = null;

  constructor(private readonly inboxPrefix = 'inbox') {
    super();
  }

  /** Read and merge every file in the inbox. */
  private async payload(): Promise<CsvJsonPayload> {
    if (this.cache) return this.cache;

    const storage = getStorage();
    const files = await storage.list('raw', this.inboxPrefix);
    const merged: Required<CsvJsonPayload> = {
      teams: [],
      players: [],
      matches: [],
      events: [],
    };

    for (const file of files) {
      const key = `${this.inboxPrefix}/${file}`;

      if (file.endsWith('.json')) {
        const chunk = await storage.readJson<CsvJsonPayload>('raw', key);
        merged.teams.push(...(chunk.teams ?? []));
        merged.players.push(...(chunk.players ?? []));
        merged.matches.push(...(chunk.matches ?? []));
        merged.events.push(...(chunk.events ?? []));
        continue;
      }

      if (!file.endsWith('.csv')) continue;

      const rows = parseCsv((await storage.read('raw', key)).toString('utf8'));
      // The filename decides what the rows are: players.csv, teams.csv, ...
      const kind = file.replace(/\.csv$/, '').split('-')[0]?.toLowerCase();

      if (kind === 'players') {
        merged.players.push(...rows.map((row) => this.toPlayer(row)));
      } else if (kind === 'teams') {
        merged.teams.push(
          ...rows.map((row) => ({
            externalId: row.external_id ?? row.id ?? row.name ?? '',
            name: row.name ?? '',
            shortName: row.short_name ?? null,
            country: row.country ?? null,
          })),
        );
      } else if (kind === 'events') {
        merged.events.push(...rows.map((row, index) => this.toEvent(row, index)));
      }
    }

    this.cache = merged;
    return merged;
  }

  private toPlayer(row: Record<string, string>): ProviderPlayer {
    const fullName = row.full_name ?? row.name ?? '';
    const [firstName = fullName, ...rest] = fullName.split(' ');

    return {
      externalId: row.external_id ?? row.id ?? fullName,
      firstName: row.first_name ?? firstName,
      lastName: row.last_name ?? rest.join(' ') ?? '',
      fullName,
      dateOfBirth: row.date_of_birth || null,
      nationality: row.nationality || null,
      heightCm: numeric(row.height_cm),
      position: row.position || null,
      teamExternalId: row.team_external_id ?? row.team_id ?? null,
    };
  }

  private toEvent(row: Record<string, string>, index: number): ProviderEvent {
    return {
      externalId: row.external_id ?? `csv-${index}`,
      matchExternalId: row.match_external_id ?? row.match_id ?? '',
      teamExternalId: row.team_external_id ?? row.team_id ?? null,
      playerExternalId: row.player_external_id ?? row.player_id ?? null,
      type: (row.type ?? 'OTHER').toUpperCase(),
      minute: numeric(row.minute) ?? 0,
      second: numeric(row.second) ?? 0,
      period: numeric(row.period) ?? 1,
      x: numeric(row.x),
      y: numeric(row.y),
      endX: numeric(row.end_x),
      endY: numeric(row.end_y),
      outcome: row.outcome || null,
    };
  }

  override async getTeams(): Promise<ProviderTeam[]> {
    return (await this.payload()).teams ?? [];
  }

  override async getPlayers(): Promise<ProviderPlayer[]> {
    return (await this.payload()).players ?? [];
  }

  override async getMatches(): Promise<ProviderMatch[]> {
    return (await this.payload()).matches ?? [];
  }

  override async getEvents(matchExternalId: string): Promise<ProviderEvent[]> {
    const events = (await this.payload()).events ?? [];
    return events.filter((event) => event.matchExternalId === matchExternalId);
  }
}
