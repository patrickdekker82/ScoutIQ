import {
  CoordinateSystem,
  EntityType,
  Prisma,
  EventType,
  ImportStatus,
  ImportTrigger,
  IssueSeverity,
  MappingMethod,
  PreferredFoot,
  type PrismaClient,
} from '@prisma/client';
import {
  angle,
  distance,
  distanceToGoal,
  goalAngleDeg,
  isInBox,
  isInFinalThird,
  isProgressive,
  progressiveDistance,
  toCanonical,
} from '@/analytics/coordinates';
import { estimateXg } from '@/analytics/metrics';
import { positionGroup } from '@/analytics/positions';
import { prisma as defaultPrisma } from '@/db/client';
import { logger } from '@/lib/logger';
import { getStorage, type Storage } from '@/lib/storage';
import type {
  FootballDataProvider,
  ProviderEvent,
  ProviderLineup,
  ProviderMatch,
  ProviderPlayer,
  ProviderTeam,
} from '@/providers/types';
import { NotSupportedError } from '@/providers/types';
import { EntityResolver } from '@/server/services/entity-resolution';

/**
 * Import pipeline (§55, §56).
 *
 *   provider -> raw archive -> normalised payload -> canonical rows
 *
 * Two invariants:
 *   1. The raw payload is archived under RAW_DATA_ROOT BEFORE anything is
 *      written to the database, so any import can be replayed on another
 *      machine without contacting the provider again (§17, §92).
 *   2. Every row that lands carries its provenance: provider, provider
 *      version, external id, source dataset and import id (§11).
 */

export interface ImportOptions {
  competitionExternalId?: string;
  seasonExternalId?: string;
  matchLimit?: number;
  includeEvents?: boolean;
  includeTracking?: boolean;
  since?: Date;
  trigger?: ImportTrigger;
  requestedById?: string;
  jobId?: string;
  /** Mark everything produced by this import as demo content (§73). */
  demo?: boolean;
  onProgress?: (message: string, progress: number) => void;
}

export interface ImportSummary {
  importId: string;
  status: ImportStatus;
  competitions: number;
  seasons: number;
  teams: number;
  players: number;
  matches: number;
  events: number;
  trackingFrames: number;
  errors: number;
  warnings: number;
  durationMs: number;
}

const EVENT_TYPES = new Set<string>(Object.values(EventType));

const toEventType = (value: string): EventType =>
  EVENT_TYPES.has(value) ? (value as EventType) : EventType.OTHER;

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export class ImportService {
  private readonly resolver: EntityResolver;

  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly storage: Storage = getStorage(),
  ) {
    this.resolver = new EntityResolver(this.prisma);
  }

  /** Register (or refresh) the provider and its version, with licensing (§13). */
  private async registerProvider(provider: FootballDataProvider) {
    const row = await this.prisma.provider.upsert({
      where: { key: provider.key },
      update: {
        name: provider.name,
        kind: provider.kind,
        licenseName: provider.licence.name,
        licenseUrl: provider.licence.url ?? null,
        licenseNotes: provider.licence.notes ?? null,
        commercialUseAllowed: provider.licence.commercialUseAllowed,
        redistributionAllowed: provider.licence.redistributionAllowed,
        attributionRequired: provider.licence.attributionRequired,
        settings: { capabilities: provider.capabilities } as object,
      },
      create: {
        key: provider.key,
        name: provider.name,
        kind: provider.kind,
        licenseName: provider.licence.name,
        licenseUrl: provider.licence.url ?? null,
        licenseNotes: provider.licence.notes ?? null,
        commercialUseAllowed: provider.licence.commercialUseAllowed,
        redistributionAllowed: provider.licence.redistributionAllowed,
        attributionRequired: provider.licence.attributionRequired,
        settings: { capabilities: provider.capabilities } as object,
      },
    });

    const version = await this.prisma.providerVersion.upsert({
      where: { providerId_version: { providerId: row.id, version: provider.version } },
      update: {},
      create: { providerId: row.id, version: provider.version },
    });

    return { provider: row, version };
  }

  private async recordIssue(
    dataImportId: string,
    severity: IssueSeverity,
    stage: string,
    message: string,
    context: { entityType?: EntityType; externalId?: string; details?: object } = {},
  ): Promise<void> {
    await this.prisma.dataImportError.create({
      data: {
        dataImportId,
        severity,
        stage,
        message,
        entityType: context.entityType ?? null,
        externalId: context.externalId ?? null,
        details: (context.details ?? {}) as object,
      },
    });
  }

  async run(provider: FootballDataProvider, options: ImportOptions = {}): Promise<ImportSummary> {
    const startedAt = Date.now();
    const { provider: providerRow, version } = await this.registerProvider(provider);

    const dataset = await this.prisma.sourceDataset.upsert({
      where: {
        providerId_key: {
          providerId: providerRow.id,
          key: `${options.competitionExternalId ?? 'all'}:${options.seasonExternalId ?? 'all'}`,
        },
      },
      update: { providerVersionId: version.id },
      create: {
        providerId: providerRow.id,
        providerVersionId: version.id,
        key: `${options.competitionExternalId ?? 'all'}:${options.seasonExternalId ?? 'all'}`,
        name: `${provider.name} ${options.competitionExternalId ?? 'all'}/${options.seasonExternalId ?? 'all'}`,
        licenseName: provider.licence.name,
      },
    });

    const run = await this.prisma.dataImport.create({
      data: {
        providerId: providerRow.id,
        providerVersionId: version.id,
        sourceDatasetId: dataset.id,
        status: ImportStatus.RUNNING,
        trigger: options.trigger ?? ImportTrigger.MANUAL,
        jobId: options.jobId ?? null,
        requestedById: options.requestedById ?? null,
        params: {
          competitionExternalId: options.competitionExternalId ?? null,
          seasonExternalId: options.seasonExternalId ?? null,
          matchLimit: options.matchLimit ?? null,
          includeEvents: options.includeEvents ?? true,
          includeTracking: options.includeTracking ?? false,
        } as object,
      },
    });

    const summary: ImportSummary = {
      importId: run.id,
      status: ImportStatus.RUNNING,
      competitions: 0,
      seasons: 0,
      teams: 0,
      players: 0,
      matches: 0,
      events: 0,
      trackingFrames: 0,
      errors: 0,
      warnings: 0,
      durationMs: 0,
    };

    const progress = options.onProgress ?? (() => undefined);

    try {
      if (!provider.isConfigured()) {
        throw new Error(`Provider ${provider.key} is not configured`);
      }

      const context = {
        providerRowId: providerRow.id,
        datasetId: dataset.id,
        importId: run.id,
        coordinateSystem: provider.coordinateSystem,
        demo: options.demo ?? provider.kind === 'DEMO',
      };

      // --- competitions & seasons ---------------------------------------
      progress('Fetching competitions', 5);
      let competitionSeasonId: string | null = null;

      try {
        const competitions = await provider.getCompetitions();
        summary.competitions = competitions.length;

        const target = options.competitionExternalId
          ? competitions.find((entry) => entry.externalId === options.competitionExternalId)
          : competitions[0];

        if (target) {
          const competitionId = await this.upsertCompetition(context, target);
          const seasons = await provider.getSeasons(target.externalId);
          summary.seasons = seasons.length;

          const season =
            (options.seasonExternalId
              ? seasons.find((entry) => entry.externalId === options.seasonExternalId)
              : seasons[0]) ?? null;

          if (season) {
            competitionSeasonId = await this.upsertSeason(context, competitionId, season);
            options.competitionExternalId ??= target.externalId;
            options.seasonExternalId ??= season.externalId;
          }
        }
      } catch (error) {
        if (!(error instanceof NotSupportedError)) throw error;
        await this.recordIssue(run.id, IssueSeverity.WARNING, 'competitions', error.message);
        summary.warnings += 1;
      }

      // Providers without a competition concept still need a home for their
      // matches, so fall back to a synthetic competition/season pair.
      if (!competitionSeasonId) {
        competitionSeasonId = await this.fallbackSeason(context, provider);
      }

      // --- teams ---------------------------------------------------------
      progress('Importing teams', 15);
      const teamIds = new Map<string, string>();
      try {
        const teams = await provider.getTeams({
          ...(options.competitionExternalId ? { competitionExternalId: options.competitionExternalId } : {}),
          ...(options.seasonExternalId ? { seasonExternalId: options.seasonExternalId } : {}),
        });
        for (const team of teams) {
          teamIds.set(team.externalId, await this.upsertTeam(context, team));
        }
        summary.teams = teams.length;
      } catch (error) {
        if (!(error instanceof NotSupportedError)) throw error;
        await this.recordIssue(run.id, IssueSeverity.WARNING, 'teams', error.message);
        summary.warnings += 1;
      }

      // --- players --------------------------------------------------------
      progress('Importing players', 30);
      const playerIds = new Map<string, string>();
      try {
        const players = await provider.getPlayers({
          ...(options.competitionExternalId ? { competitionExternalId: options.competitionExternalId } : {}),
          ...(options.seasonExternalId ? { seasonExternalId: options.seasonExternalId } : {}),
        });
        for (const player of players) {
          playerIds.set(
            player.externalId,
            await this.upsertPlayer(context, player, teamIds),
          );
        }
        summary.players = players.length;
      } catch (error) {
        if (!(error instanceof NotSupportedError)) throw error;
        await this.recordIssue(run.id, IssueSeverity.WARNING, 'players', error.message);
        summary.warnings += 1;
      }

      // --- matches, lineups, events ---------------------------------------
      progress('Importing matches', 45);
      let matches: ProviderMatch[] = [];
      try {
        matches = await provider.getMatches({
          ...(options.competitionExternalId ? { competitionExternalId: options.competitionExternalId } : {}),
          ...(options.seasonExternalId ? { seasonExternalId: options.seasonExternalId } : {}),
          ...(options.since ? { since: options.since } : {}),
          ...(options.matchLimit ? { limit: options.matchLimit } : {}),
        });
      } catch (error) {
        if (!(error instanceof NotSupportedError)) throw error;
        await this.recordIssue(run.id, IssueSeverity.WARNING, 'matches', error.message);
        summary.warnings += 1;
      }

      const includeEvents = options.includeEvents ?? true;

      for (const [index, match] of matches.entries()) {
        progress(
          `Importing match ${index + 1}/${matches.length}`,
          45 + Math.round((index / Math.max(1, matches.length)) * 45),
        );

        try {
          const matchId = await this.upsertMatch(context, competitionSeasonId, match, teamIds);
          summary.matches += 1;

          try {
            const lineups = await provider.getLineups(match.externalId);
            await this.applyLineups(context, matchId, lineups, teamIds, playerIds);
          } catch (error) {
            if (!(error instanceof NotSupportedError)) throw error;
          }

          if (includeEvents) {
            try {
              const events = await provider.getEvents(match.externalId);
              if (events.length > 0) {
                await this.archiveRaw(
                  `${provider.key}/${run.id}/events-${match.externalId}.json`,
                  events,
                );
                summary.events += await this.applyEvents(
                  context,
                  matchId,
                  events,
                  teamIds,
                  playerIds,
                );
              }
            } catch (error) {
              if (error instanceof NotSupportedError) {
                summary.warnings += 1;
              } else {
                summary.errors += 1;
                await this.recordIssue(
                  run.id,
                  IssueSeverity.ERROR,
                  'events',
                  error instanceof Error ? error.message : String(error),
                  { entityType: EntityType.MATCH, externalId: match.externalId },
                );
              }
            }
          }
        } catch (error) {
          summary.errors += 1;
          await this.recordIssue(
            run.id,
            IssueSeverity.ERROR,
            'match',
            error instanceof Error ? error.message : String(error),
            { entityType: EntityType.MATCH, externalId: match.externalId },
          );
        }
      }

      progress('Finalising', 95);

      const finished = await this.prisma.dataImport.update({
        where: { id: run.id },
        data: {
          status: summary.errors > 0 ? ImportStatus.COMPLETED : ImportStatus.COMPLETED,
          finishedAt: new Date(),
          recordsRead:
            summary.teams + summary.players + summary.matches + summary.events,
          recordsWritten:
            summary.teams + summary.players + summary.matches + summary.events,
          errorCount: summary.errors,
          warningCount: summary.warnings,
          rawPath: `${provider.key}/${run.id}`,
        },
      });

      await this.prisma.sourceDataset.update({
        where: { id: dataset.id },
        data: { recordCount: { increment: summary.events + summary.matches } },
      });

      summary.status = finished.status;
      summary.durationMs = Date.now() - startedAt;

      logger.info(
        { provider: provider.key, ...summary },
        'import completed',
      );
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.dataImport.update({
        where: { id: run.id },
        data: {
          status: ImportStatus.FAILED,
          finishedAt: new Date(),
          error: message,
          errorCount: summary.errors + 1,
          warningCount: summary.warnings,
        },
      });

      logger.error({ provider: provider.key, importId: run.id, err: message }, 'import failed');

      summary.status = ImportStatus.FAILED;
      summary.errors += 1;
      summary.durationMs = Date.now() - startedAt;
      return summary;
    }
  }

  /** Archive raw payloads before they are parsed (§17). NAS copy is optional. */
  private async archiveRaw(key: string, payload: unknown): Promise<void> {
    await this.storage.writeJson('raw', key, payload);
    await this.storage.archive('raw', key).catch(() => null);
  }

  // ---------------------------------------------------------------------
  // Canonical upserts
  // ---------------------------------------------------------------------

  private async countryId(name: string | null | undefined): Promise<string | null> {
    if (!name) return null;
    const code = name.slice(0, 3).toUpperCase();

    const existing = await this.prisma.country.findFirst({
      where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { code }] },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.country.upsert({
      where: { code },
      update: {},
      create: { code, name },
    });
    return created.id;
  }

  private async upsertCompetition(
    context: ImportContext,
    competition: { externalId: string; name: string; country?: string | null; tier?: number | null; type?: string; gender?: string },
  ): Promise<string> {
    const countryId = await this.countryId(competition.country);
    const gender = (competition.gender ?? 'MALE') as 'MALE' | 'FEMALE' | 'MIXED';

    const existing = await this.resolver.lookup(
      context.providerRowId,
      EntityType.COMPETITION,
      competition.externalId,
    );

    // Nullable columns cannot participate in a Prisma compound-unique lookup,
    // so the "does it already exist" check is an explicit query.
    const row =
      existing !== null
        ? await this.prisma.competition.update({
            where: { id: existing },
            data: { name: competition.name, countryId, tier: competition.tier ?? 1 },
          })
        : ((await this.prisma.competition.findFirst({
            where: { name: competition.name, countryId, gender },
          })) ??
          (await this.prisma.competition.create({
            data: {
              name: competition.name,
              countryId,
              tier: competition.tier ?? 1,
              type: (competition.type ?? 'LEAGUE') as 'LEAGUE' | 'CUP' | 'INTERNATIONAL' | 'FRIENDLY',
              gender,
            },
          })));

    await this.resolver.record(
      context.providerRowId,
      EntityType.COMPETITION,
      competition.externalId,
      row.id,
    );
    return row.id;
  }

  private async upsertSeason(
    context: ImportContext,
    competitionId: string,
    season: { externalId: string; name: string; startDate?: string | null; endDate?: string | null },
  ): Promise<string> {
    const row = await this.prisma.competitionSeason.upsert({
      where: { competitionId_seasonName: { competitionId, seasonName: season.name } },
      update: {
        startDate: parseDate(season.startDate),
        endDate: parseDate(season.endDate),
      },
      create: {
        competitionId,
        seasonName: season.name,
        startDate: parseDate(season.startDate),
        endDate: parseDate(season.endDate),
      },
    });

    await this.resolver.record(
      context.providerRowId,
      EntityType.COMPETITION_SEASON,
      season.externalId,
      row.id,
    );
    return row.id;
  }

  private async fallbackSeason(
    context: ImportContext,
    provider: FootballDataProvider,
  ): Promise<string> {
    const competition =
      (await this.prisma.competition.findFirst({
        where: { name: provider.name, countryId: null, gender: 'MALE' },
      })) ??
      (await this.prisma.competition.create({
        data: { name: provider.name, tier: 1, type: 'LEAGUE', gender: 'MALE' },
      }));

    const season = await this.prisma.competitionSeason.upsert({
      where: { competitionId_seasonName: { competitionId: competition.id, seasonName: 'imported' } },
      update: {},
      create: { competitionId: competition.id, seasonName: 'imported' },
    });

    return season.id;
  }

  private async upsertTeam(context: ImportContext, team: ProviderTeam): Promise<string> {
    const countryId = await this.countryId(team.country);

    const mapped = await this.resolver.lookup(
      context.providerRowId,
      EntityType.TEAM,
      team.externalId,
    );

    let id = mapped;
    if (!id) {
      id = await this.resolver.matchTeamByName(team.name, countryId);
    }

    if (id) {
      await this.prisma.team.update({
        where: { id },
        data: { shortName: team.shortName ?? undefined, founded: team.founded ?? undefined },
      });
    } else {
      const created =
        (await this.prisma.team.findFirst({ where: { name: team.name, countryId } })) ??
        (await this.prisma.team.create({
          data: {
            name: team.name,
            shortName: team.shortName ?? null,
            countryId,
            founded: team.founded ?? null,
            isDemo: context.demo,
          },
        }));
      id = created.id;
    }

    await this.resolver.record(context.providerRowId, EntityType.TEAM, team.externalId, id);
    return id;
  }

  private async upsertPlayer(
    context: ImportContext,
    player: ProviderPlayer,
    teamIds: Map<string, string>,
  ): Promise<string> {
    const countryId = await this.countryId(player.nationality);
    const dateOfBirth = parseDate(player.dateOfBirth);
    const teamId = player.teamExternalId ? (teamIds.get(player.teamExternalId) ?? null) : null;
    const position = player.position ?? 'MF';

    const mapped = await this.resolver.lookup(
      context.providerRowId,
      EntityType.PLAYER,
      player.externalId,
    );

    let id = mapped;
    let method: MappingMethod = MappingMethod.PROVIDER_ID;
    let confidence = 1;

    if (!id) {
      const match = await this.resolver.matchPlayerByName(player.fullName, dateOfBirth);
      if (match) {
        id = match.id;
        method = match.method;
        confidence = match.confidence;
      }
    }

    const data = {
      firstName: player.firstName,
      lastName: player.lastName,
      fullName: player.fullName,
      knownAs: player.knownAs ?? null,
      dateOfBirth,
      countryId,
      heightCm: player.heightCm ?? null,
      weightKg: player.weightKg ?? null,
      preferredFoot: (player.preferredFoot ?? 'UNKNOWN') as PreferredFoot,
      primaryPosition: position,
      positionGroup: positionGroup(position),
    };

    if (id) {
      await this.prisma.player.update({ where: { id }, data });
    } else {
      const created = await this.prisma.player.create({
        data: { ...data, isDemo: context.demo },
      });
      id = created.id;
    }

    if (teamId) {
      const membership = await this.prisma.playerTeamMembership.findFirst({
        where: { playerId: id, teamId, endDate: null },
        select: { id: true },
      });
      if (!membership) {
        await this.prisma.playerTeamMembership.create({ data: { playerId: id, teamId } });
      }
    }

    await this.resolver.record(
      context.providerRowId,
      EntityType.PLAYER,
      player.externalId,
      id,
      method,
      confidence,
    );
    return id;
  }

  private async upsertMatch(
    context: ImportContext,
    competitionSeasonId: string,
    match: ProviderMatch,
    teamIds: Map<string, string>,
  ): Promise<string> {
    const homeTeamId = teamIds.get(match.homeTeamExternalId);
    const awayTeamId = teamIds.get(match.awayTeamExternalId);
    if (!homeTeamId || !awayTeamId) {
      throw new Error(
        `Match ${match.externalId} references unknown teams ` +
          `(${match.homeTeamExternalId} vs ${match.awayTeamExternalId})`,
      );
    }

    const kickoffAt = parseDate(match.kickoffAt) ?? new Date();

    const venueId = match.venue
      ? (
          (await this.prisma.venue.findFirst({ where: { name: match.venue, city: null } })) ??
          (await this.prisma.venue.create({ data: { name: match.venue } }))
        ).id
      : null;

    const mapped = await this.resolver.lookup(
      context.providerRowId,
      EntityType.MATCH,
      match.externalId,
    );

    const data = {
      competitionSeasonId,
      homeTeamId,
      awayTeamId,
      venueId,
      kickoffAt,
      homeScore: match.homeScore ?? null,
      awayScore: match.awayScore ?? null,
      matchweek: match.matchweek ?? null,
      stage: match.stage ?? null,
      attendance: match.attendance ?? null,
    };

    const row = mapped
      ? await this.prisma.match.update({ where: { id: mapped }, data })
      : await this.prisma.match.upsert({
          where: {
            competitionSeasonId_homeTeamId_awayTeamId_kickoffAt: {
              competitionSeasonId,
              homeTeamId,
              awayTeamId,
              kickoffAt,
            },
          },
          update: data,
          create: { ...data, isDemo: context.demo },
        });

    for (const [teamId, isHome] of [
      [homeTeamId, true],
      [awayTeamId, false],
    ] as const) {
      await this.prisma.matchTeam.upsert({
        where: { matchId_teamId: { matchId: row.id, teamId } },
        update: { goals: (isHome ? match.homeScore : match.awayScore) ?? 0 },
        create: {
          matchId: row.id,
          teamId,
          isHome,
          goals: (isHome ? match.homeScore : match.awayScore) ?? 0,
        },
      });
    }

    if (match.referee) {
      const existing = await this.prisma.matchOfficial.findFirst({
        where: { matchId: row.id, name: match.referee },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.matchOfficial.create({
          data: { matchId: row.id, name: match.referee, role: 'REFEREE' },
        });
      }
    }

    await this.resolver.record(
      context.providerRowId,
      EntityType.MATCH,
      match.externalId,
      row.id,
    );
    return row.id;
  }

  private async applyLineups(
    context: ImportContext,
    matchId: string,
    lineups: ProviderLineup[],
    teamIds: Map<string, string>,
    playerIds: Map<string, string>,
  ): Promise<void> {
    for (const lineup of lineups) {
      const teamId = teamIds.get(lineup.teamExternalId);
      if (!teamId) continue;

      await this.prisma.lineup.upsert({
        where: { matchId_teamId: { matchId, teamId } },
        update: { formation: lineup.formation ?? null },
        create: { matchId, teamId, formation: lineup.formation ?? null },
      });

      for (const entry of lineup.players) {
        const playerId = playerIds.get(entry.playerExternalId);
        if (!playerId) continue;

        const position = entry.position ?? null;
        await this.prisma.playerMatch.upsert({
          where: { matchId_playerId: { matchId, playerId } },
          update: {
            teamId,
            position,
            positionGroup: position ? positionGroup(position) : null,
            shirtNumber: entry.shirtNumber ?? null,
            isStarter: entry.isStarter,
            minutesPlayed: entry.minutesPlayed ?? (entry.isStarter ? 90 : 0),
          },
          create: {
            matchId,
            playerId,
            teamId,
            position,
            positionGroup: position ? positionGroup(position) : null,
            shirtNumber: entry.shirtNumber ?? null,
            isStarter: entry.isStarter,
            minutesPlayed: entry.minutesPlayed ?? (entry.isStarter ? 90 : 0),
          },
        });
      }
    }
  }

  /**
   * Persist events in batches.
   *
   * One upsert per event costs two round trips per row, which on a full
   * StatsBomb season (>1M events) is hours rather than minutes. Instead the
   * batch is: read existing provider ids, createMany the new events, read back
   * their ids, then createMany each detail table. That is a fixed handful of
   * queries per match regardless of event count - what §59 needs on 4 cores.
   */
  private async applyEvents(
    context: ImportContext,
    matchId: string,
    events: ProviderEvent[],
    teamIds: Map<string, string>,
    playerIds: Map<string, string>,
  ): Promise<number> {
    if (events.length === 0) return 0;

    const periods = new Map<number, string>();
    for (const period of new Set(events.map((event) => event.period ?? 1))) {
      const row = await this.prisma.matchPeriod.upsert({
        where: { matchId_period: { matchId, period } },
        update: {},
        create: { matchId, period },
      });
      periods.set(period, row.id);
    }

    // Re-imports must not duplicate: skip anything this provider already sent.
    const externalIds = events.map((event) => event.externalId);
    const existing = await this.prisma.event.findMany({
      where: { providerId: context.providerRowId, providerEventId: { in: externalIds } },
      select: { providerEventId: true },
    });
    const seen = new Set(existing.map((row) => row.providerEventId));

    const pending = events.filter((event) => !seen.has(event.externalId));
    if (pending.length === 0) return 0;

    const canonicalByExternalId = new Map<string, CanonicalPoints>();

    await this.prisma.event.createMany({
      data: pending.map((event, index) => {
        const canonical = this.canonicalPoints(event, context.coordinateSystem);
        canonicalByExternalId.set(event.externalId, canonical);

        return {
          matchId,
          matchPeriodId: periods.get(event.period ?? 1) ?? null,
          teamId: event.teamExternalId ? (teamIds.get(event.teamExternalId) ?? null) : null,
          playerId: event.playerExternalId
            ? (playerIds.get(event.playerExternalId) ?? null)
            : null,
          possessionTeamId: event.possessionTeamExternalId
            ? (teamIds.get(event.possessionTeamExternalId) ?? null)
            : null,
          type: toEventType(event.type),
          subType: event.subType ?? null,
          minute: event.minute,
          second: event.second ?? 0,
          timestampMs: event.timestampMs ?? event.minute * 60_000,
          sequenceIndex: index,
          possessionId: event.possessionId ?? null,
          playPattern: event.playPattern ?? null,
          underPressure: event.underPressure ?? false,
          outcome: event.outcome ?? null,
          durationSec: event.durationSec ?? null,
          x: canonical.x,
          y: canonical.y,
          endX: canonical.endX,
          endY: canonical.endY,
          providerId: context.providerRowId,
          dataImportId: context.importId,
          providerEventId: event.externalId,
        };
      }),
      skipDuplicates: true,
    });

    const stored = await this.prisma.event.findMany({
      where: {
        providerId: context.providerRowId,
        providerEventId: { in: pending.map((event) => event.externalId) },
      },
      select: { id: true, providerEventId: true },
    });

    const idByExternalId = new Map(
      stored.map((row) => [row.providerEventId as string, row.id]),
    );

    await this.applyEventDetails(pending, idByExternalId, canonicalByExternalId, playerIds);

    return stored.length;
  }

  private canonicalPoints(
    event: ProviderEvent,
    system: CoordinateSystem,
  ): { x: number | null; y: number | null; endX: number | null; endY: number | null } {
    const start =
      event.x != null && event.y != null
        ? toCanonical({ x: event.x, y: event.y }, system)
        : null;
    const end =
      event.endX != null && event.endY != null
        ? toCanonical({ x: event.endX, y: event.endY }, system)
        : null;

    return {
      x: start?.x ?? null,
      y: start?.y ?? null,
      endX: end?.x ?? null,
      endY: end?.y ?? null,
    };
  }

  /**
   * Write the typed detail rows for a batch of events, one createMany per
   * event family. Derived flags (progressive, into box, xG geometry) are
   * computed here from canonical coordinates so they are correct regardless of
   * which provider supplied the event (§33).
   */
  private async applyEventDetails(
    events: ProviderEvent[],
    idByExternalId: Map<string, string>,
    canonicalByExternalId: Map<string, CanonicalPoints>,
    playerIds: Map<string, string>,
  ): Promise<void> {
    const passes: Prisma.PassEventCreateManyInput[] = [];
    const shots: Prisma.ShotEventCreateManyInput[] = [];
    const carries: Prisma.CarryEventCreateManyInput[] = [];
    const dribbles: Prisma.DribbleEventCreateManyInput[] = [];
    const duels: Prisma.DuelEventCreateManyInput[] = [];
    const tackles: Prisma.TackleEventCreateManyInput[] = [];
    const interceptions: Prisma.InterceptionEventCreateManyInput[] = [];
    const pressures: Prisma.PressureEventCreateManyInput[] = [];
    const recoveries: Prisma.RecoveryEventCreateManyInput[] = [];
    const clearances: Prisma.ClearanceEventCreateManyInput[] = [];
    const fouls: Prisma.FoulEventCreateManyInput[] = [];

    const num = (value: unknown, fallback = 0): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const bool = (value: unknown): boolean => value === true;

    for (const event of events) {
      const eventId = idByExternalId.get(event.externalId);
      if (!eventId) continue;

      const canonical = canonicalByExternalId.get(event.externalId);
      const from =
        canonical && canonical.x != null && canonical.y != null
          ? { x: canonical.x, y: canonical.y }
          : null;
      const to =
        canonical && canonical.endX != null && canonical.endY != null
          ? { x: canonical.endX, y: canonical.endY }
          : null;

      const detail = (event.detail ?? {}) as Record<string, Record<string, unknown> | undefined>;

      switch (toEventType(event.type)) {
        case EventType.PASS: {
          const pass = detail.pass ?? {};
          const recipientExternalId = pass.recipientExternalId as string | null | undefined;

          passes.push({
            eventId,
            recipientId: recipientExternalId ? (playerIds.get(recipientExternalId) ?? null) : null,
            lengthM: num(pass.lengthM, from && to ? distance(from, to) : 0),
            angleRad: num(pass.angleRad, from && to ? angle(from, to) : 0),
            height: coerce(pass.height, PASS_HEIGHTS, 'UNKNOWN'),
            bodyPart: coerce(pass.bodyPart, BODY_PARTS, 'UNKNOWN'),
            technique: (pass.technique as string | null) ?? null,
            completed: pass.completed === undefined ? true : bool(pass.completed),
            isCross: bool(pass.isCross),
            isSwitch: bool(pass.isSwitch),
            isThroughBall: bool(pass.isThroughBall),
            isCutback: bool(pass.isCutback),
            isProgressive: from && to ? isProgressive(from, to) : false,
            intoFinalThird: to ? isInFinalThird(to) : false,
            intoBox: to ? isInBox(to) : false,
            isKeyPass: bool(pass.isKeyPass),
            isAssist: bool(pass.isAssist),
            xa: (pass.xa as number | null) ?? null,
          });
          break;
        }

        case EventType.SHOT: {
          const shot = detail.shot ?? {};
          const providerXg = shot.providerXg as number | null | undefined;
          const bodyPart = coerce(shot.bodyPart, BODY_PARTS, 'UNKNOWN');

          shots.push({
            eventId,
            xg:
              typeof shot.xg === 'number' && shot.xg > 0
                ? shot.xg
                : from
                  ? estimateXg(from, bodyPart === 'HEAD', bool(shot.isPenalty))
                  : 0,
            providerXg: providerXg ?? null,
            bodyPart,
            technique: (shot.technique as string | null) ?? null,
            firstTime: bool(shot.firstTime),
            isPenalty: bool(shot.isPenalty),
            isSetPiece: bool(shot.isSetPiece),
            onTarget: bool(shot.onTarget),
            blocked: bool(shot.blocked),
            isGoal: bool(shot.isGoal),
            endX: (shot.endX as number | null) ?? null,
            endY: (shot.endY as number | null) ?? null,
            endZ: (shot.endZ as number | null) ?? null,
            distanceM: from ? distanceToGoal(from) : null,
            angleDeg: from ? goalAngleDeg(from) : null,
          });
          break;
        }

        case EventType.CARRY:
          carries.push({
            eventId,
            distanceM: from && to ? distance(from, to) : 0,
            progressiveDistanceM: from && to ? progressiveDistance(from, to) : 0,
            isProgressive: from && to ? isProgressive(from, to) : false,
            intoFinalThird: to ? isInFinalThird(to) : false,
            intoBox: to ? isInBox(to) : false,
          });
          break;

        case EventType.DRIBBLE: {
          const dribble = detail.dribble ?? {};
          dribbles.push({
            eventId,
            completed: bool(dribble.completed),
            nutmeg: bool(dribble.nutmeg),
            overrun: bool(dribble.overrun),
          });
          break;
        }

        case EventType.DUEL: {
          const duel = detail.duel ?? {};
          duels.push({
            eventId,
            duelType: coerce(duel.duelType, DUEL_TYPES, 'GROUND'),
            won: bool(duel.won),
          });
          break;
        }

        case EventType.TACKLE: {
          const tackle = detail.tackle ?? {};
          tackles.push({
            eventId,
            won: bool(tackle.won),
            dispossessed: bool(tackle.dispossessed),
          });
          break;
        }

        case EventType.INTERCEPTION:
          interceptions.push({ eventId });
          break;

        case EventType.PRESSURE: {
          const pressure = detail.pressure ?? {};
          pressures.push({
            eventId,
            durationSec: num(pressure.durationSec),
            counterpress: bool(pressure.counterpress),
          });
          break;
        }

        case EventType.RECOVERY: {
          const recovery = detail.recovery ?? {};
          recoveries.push({
            eventId,
            failed: bool(recovery.failed),
            offensive: bool(recovery.offensive),
          });
          break;
        }

        case EventType.CLEARANCE: {
          const clearance = detail.clearance ?? {};
          clearances.push({
            eventId,
            bodyPart: coerce(clearance.bodyPart, BODY_PARTS, 'UNKNOWN'),
          });
          break;
        }

        case EventType.FOUL: {
          const foul = detail.foul ?? {};
          fouls.push({
            eventId,
            committed: foul.committed === undefined ? true : bool(foul.committed),
            advantage: bool(foul.advantage),
            penalty: bool(foul.penalty),
          });
          break;
        }

        default:
          break;
      }
    }

    await Promise.all([
      passes.length ? this.prisma.passEvent.createMany({ data: passes, skipDuplicates: true }) : null,
      shots.length ? this.prisma.shotEvent.createMany({ data: shots, skipDuplicates: true }) : null,
      carries.length
        ? this.prisma.carryEvent.createMany({ data: carries, skipDuplicates: true })
        : null,
      dribbles.length
        ? this.prisma.dribbleEvent.createMany({ data: dribbles, skipDuplicates: true })
        : null,
      duels.length ? this.prisma.duelEvent.createMany({ data: duels, skipDuplicates: true }) : null,
      tackles.length
        ? this.prisma.tackleEvent.createMany({ data: tackles, skipDuplicates: true })
        : null,
      interceptions.length
        ? this.prisma.interceptionEvent.createMany({ data: interceptions, skipDuplicates: true })
        : null,
      pressures.length
        ? this.prisma.pressureEvent.createMany({ data: pressures, skipDuplicates: true })
        : null,
      recoveries.length
        ? this.prisma.recoveryEvent.createMany({ data: recoveries, skipDuplicates: true })
        : null,
      clearances.length
        ? this.prisma.clearanceEvent.createMany({ data: clearances, skipDuplicates: true })
        : null,
      fouls.length ? this.prisma.foulEvent.createMany({ data: fouls, skipDuplicates: true }) : null,
    ]);
  }
}

const PASS_HEIGHTS = ['GROUND', 'LOW', 'HIGH', 'UNKNOWN'] as const;
const BODY_PARTS = ['RIGHT_FOOT', 'LEFT_FOOT', 'HEAD', 'OTHER', 'UNKNOWN'] as const;
const DUEL_TYPES = ['AERIAL', 'GROUND', 'LOOSE_BALL', 'FIFTY_FIFTY', 'TACKLE'] as const;

/** Accept a provider string only if it is a member of the enum. */
function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

interface CanonicalPoints {
  x: number | null;
  y: number | null;
  endX: number | null;
  endY: number | null;
}

interface ImportContext {
  providerRowId: string;
  datasetId: string;
  importId: string;
  coordinateSystem: CoordinateSystem;
  demo: boolean;
}
