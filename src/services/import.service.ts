import type { PrismaClient } from '@prisma/client';
import { getPrisma } from '../lib/prisma.js';
import { getStorage, type Storage } from '../lib/storage.js';
import { logger } from '../lib/logger.js';
import type { DataProvider, NormalisedMatchStat, NormalisedPlayer, ProviderPayload } from '../providers/index.js';

/**
 * Import pipeline: provider -> raw archive -> normalised database rows.
 *
 * The raw payload is always archived under RAW_DATA_ROOT first, so an import
 * can be replayed on another machine after a migration without contacting the
 * provider again.
 */
export class ImportService {
  constructor(
    private readonly prisma: PrismaClient = getPrisma(),
    private readonly storage: Storage = getStorage(),
  ) {}

  private async ensureProviderRow(provider: DataProvider) {
    return this.prisma.dataProvider.upsert({
      where: { key: provider.key },
      update: { name: provider.name },
      create: { key: provider.key, name: provider.name },
    });
  }

  async run(provider: DataProvider, options: { since?: Date; timeoutMs?: number } = {}) {
    const row = await this.ensureProviderRow(provider);
    const run = await this.prisma.importRun.create({
      data: { providerId: row.id, status: 'RUNNING' },
    });

    try {
      if (!provider.isConfigured()) {
        throw new Error(`Provider ${provider.key} is not configured`);
      }

      const payload = await provider.fetch({
        timeoutMs: options.timeoutMs ?? 60_000,
        ...(options.since ? { since: options.since } : {}),
      });

      const rawKey = `${provider.key}/${run.id}.json`;
      await this.storage.writeJson('raw', rawKey, payload);
      // Best effort: a NAS/off-site archive is optional infrastructure.
      const archived = await this.storage.archive('raw', rawKey).catch(() => null);

      const written = await this.persist(row.id, payload);

      const finished = await this.prisma.importRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          recordsRead: payload.players.length + payload.matchStats.length,
          recordsWritten: written,
          rawPath: rawKey,
        },
      });

      logger.info(
        { provider: provider.key, runId: run.id, written, archived: Boolean(archived) },
        'import finished',
      );
      return finished;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ provider: provider.key, runId: run.id, err: message }, 'import failed');
      return this.prisma.importRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message },
      });
    }
  }

  private async persist(providerId: string, payload: ProviderPayload): Promise<number> {
    let written = 0;
    for (const player of payload.players) {
      await this.upsertPlayer(providerId, player);
      written += 1;
    }
    for (const stat of payload.matchStats) {
      const inserted = await this.upsertMatchStat(providerId, stat);
      if (inserted) written += 1;
    }
    return written;
  }

  private async upsertTeam(name: string, country: string, competitionId?: string) {
    return this.prisma.team.upsert({
      where: { name_country: { name, country } },
      update: competitionId ? { competitionId } : {},
      create: { name, country, ...(competitionId ? { competitionId } : {}) },
    });
  }

  private async upsertPlayer(providerId: string, input: NormalisedPlayer) {
    const team = input.teamName
      ? await this.upsertTeam(input.teamName, input.teamCountry ?? 'Unknown')
      : null;

    const existing = await this.prisma.externalRef.findUnique({
      where: { providerId_externalId: { providerId, externalId: input.externalId } },
    });

    const data = {
      firstName: input.firstName,
      lastName: input.lastName,
      position: input.position,
      birthDate: input.birthDate ? new Date(input.birthDate) : null,
      nationality: input.nationality ?? null,
      footPref: input.footPref ?? null,
      heightCm: input.heightCm ?? null,
      teamId: team?.id ?? null,
    };

    if (existing) {
      return this.prisma.player.update({ where: { id: existing.playerId }, data });
    }

    const player = await this.prisma.player.create({ data });
    await this.prisma.externalRef.create({
      data: { providerId, playerId: player.id, externalId: input.externalId },
    });
    return player;
  }

  private async upsertMatchStat(providerId: string, input: NormalisedMatchStat): Promise<boolean> {
    const ref = await this.prisma.externalRef.findUnique({
      where: { providerId_externalId: { providerId, externalId: input.externalPlayerId } },
    });
    if (!ref) return false;

    const competition = await this.prisma.competition.upsert({
      where: { name_season: { name: input.competition, season: input.season } },
      update: {},
      create: { name: input.competition, season: input.season, country: input.country },
    });

    const [homeTeam, awayTeam] = await Promise.all([
      this.upsertTeam(input.homeTeam, input.country, competition.id),
      this.upsertTeam(input.awayTeam, input.country, competition.id),
    ]);

    const kickoffAt = new Date(input.kickoffAt);
    const match =
      (await this.prisma.match.findFirst({
        where: { competitionId: competition.id, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id, kickoffAt },
      })) ??
      (await this.prisma.match.create({
        data: {
          competitionId: competition.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          kickoffAt,
        },
      }));

    const stats = {
      minutesPlayed: input.minutesPlayed,
      goals: input.goals,
      assists: input.assists,
      shots: input.shots,
      xg: input.xg,
      xa: input.xa,
      passes: input.passes,
      passesCompleted: input.passesCompleted,
      progressivePasses: input.progressivePasses,
      duelsWon: input.duelsWon,
      duelsTotal: input.duelsTotal,
    };

    await this.prisma.playerMatchStat.upsert({
      where: { playerId_matchId: { playerId: ref.playerId, matchId: match.id } },
      update: stats,
      create: { playerId: ref.playerId, matchId: match.id, ...stats },
    });
    return true;
  }
}
