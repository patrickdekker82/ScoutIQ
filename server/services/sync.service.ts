import {
  EntityType,
  ImportStatus,
  type PrismaClient,
  type ProviderSyncSchedule,
} from '@prisma/client';
import { logger } from '@/lib/logger';
import { prisma as defaultPrisma } from '@/db/client';
import { createProvider } from '@/providers';
import { ImportService, type ImportSummary } from '@/server/services/import.service';

/**
 * External API synchronisation (§88 phase 8).
 *
 * A schedule is a standing instruction to keep one competition season in step
 * with a provider. Each run asks the provider only for matches after the
 * watermark, minus an overlap window, because providers correct fixtures after
 * the fact and a strict watermark would silently skip the correction.
 *
 * Failures are recorded on the schedule rather than thrown away: a sync that
 * has been failing for a week must be visible without reading worker logs.
 * After too many consecutive failures the schedule disables itself so a broken
 * key does not hammer a paid API indefinitely (§62).
 */

export const MAX_CONSECUTIVE_FAILURES = 5;

export interface SyncRunResult {
  scheduleId: string;
  scheduleName: string;
  providerKey: string;
  status: ImportStatus;
  skippedReason?: string;
  since: string | null;
  summary?: ImportSummary;
  error?: string;
}

export class SyncService {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly imports: ImportService = new ImportService(),
  ) {}

  /** Where the next run should start reading from. */
  windowStart(schedule: Pick<ProviderSyncSchedule, 'watermark' | 'overlapHours'>): Date | null {
    if (!schedule.watermark) return null;
    return new Date(schedule.watermark.getTime() - schedule.overlapHours * 3_600_000);
  }

  async listSchedules() {
    return this.prisma.providerSyncSchedule.findMany({
      include: {
        provider: { select: { key: true, name: true, kind: true, enabled: true } },
        createdBy: { select: { displayName: true } },
      },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    });
  }

  /** Run one schedule now. Never throws: the outcome is recorded on the row. */
  async runSchedule(scheduleId: string): Promise<SyncRunResult> {
    const schedule = await this.prisma.providerSyncSchedule.findUnique({
      where: { id: scheduleId },
      include: { provider: { select: { key: true, enabled: true } } },
    });

    if (!schedule) throw new Error(`No sync schedule ${scheduleId}`);

    const base = {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      providerKey: schedule.provider.key,
      since: this.windowStart(schedule)?.toISOString() ?? null,
    };

    if (!schedule.provider.enabled) {
      return { ...base, status: ImportStatus.CANCELLED, skippedReason: 'provider disabled' };
    }

    let provider;
    try {
      provider = createProvider(schedule.provider.key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(schedule.id, message);
      return { ...base, status: ImportStatus.FAILED, error: message };
    }

    // An unconfigured provider is a missing API key, not a broken schedule:
    // skip it without counting a failure (§92 - say why, do not guess).
    if (!provider.isConfigured()) {
      return {
        ...base,
        status: ImportStatus.CANCELLED,
        skippedReason: `${schedule.provider.key} has no API key configured`,
      };
    }

    const since = this.windowStart(schedule);

    try {
      const summary = await this.imports.run(provider, {
        ...(schedule.competitionExternalId
          ? { competitionExternalId: schedule.competitionExternalId }
          : {}),
        ...(schedule.seasonExternalId ? { seasonExternalId: schedule.seasonExternalId } : {}),
        ...(schedule.matchLimit ? { matchLimit: schedule.matchLimit } : {}),
        ...(since ? { since } : {}),
        ...(schedule.createdById ? { requestedById: schedule.createdById } : {}),
        includeEvents: schedule.includeEvents,
        includeTracking: schedule.includeTracking,
        trigger: 'SCHEDULED',
      });

      const watermark = await this.newestKickoff(schedule, since);

      await this.prisma.providerSyncSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: summary.status,
          lastError: null,
          consecutiveFailures: 0,
          // Only advance the watermark on a clean run: a partial import that
          // moved it forward would leave a permanent hole in the data.
          ...(summary.status === ImportStatus.COMPLETED && watermark ? { watermark } : {}),
        },
      });

      return { ...base, status: summary.status, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(schedule.id, message);
      logger.error({ scheduleId: schedule.id, err: message }, 'provider sync failed');
      return { ...base, status: ImportStatus.FAILED, error: message };
    }
  }

  /** Run every enabled schedule, one provider at a time to respect rate limits. */
  async runDue(): Promise<SyncRunResult[]> {
    const schedules = await this.prisma.providerSyncSchedule.findMany({
      where: { enabled: true, provider: { enabled: true } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    const results: SyncRunResult[] = [];
    for (const schedule of schedules) {
      results.push(await this.runSchedule(schedule.id));
    }
    return results;
  }

  /**
   * Newest kickoff now present for this schedule's competition season.
   *
   * Reading it back from the database rather than trusting the provider's
   * response means the watermark can only ever point at data we actually hold.
   */
  private async newestKickoff(
    schedule: ProviderSyncSchedule,
    since: Date | null,
  ): Promise<Date | null> {
    // The provider's season id is resolved through the mapping table, the same
    // table the importer wrote it to - there is no other link between an
    // external id and an internal row (§11).
    let competitionSeasonId: string | null = null;
    if (schedule.seasonExternalId) {
      const mapping = await this.prisma.externalEntityMapping.findUnique({
        where: {
          providerId_entityType_externalId: {
            providerId: schedule.providerId,
            entityType: EntityType.COMPETITION_SEASON,
            externalId: schedule.seasonExternalId,
          },
        },
        select: { internalId: true },
      });
      if (!mapping) return null;
      competitionSeasonId = mapping.internalId;
    }

    const match = await this.prisma.match.findFirst({
      where: {
        ...(competitionSeasonId ? { competitionSeasonId } : {}),
        ...(since ? { kickoffAt: { gte: since } } : {}),
      },
      select: { kickoffAt: true },
      orderBy: { kickoffAt: 'desc' },
    });

    return match?.kickoffAt ?? null;
  }

  private async recordFailure(scheduleId: string, message: string): Promise<void> {
    const updated = await this.prisma.providerSyncSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: new Date(),
        lastStatus: ImportStatus.FAILED,
        lastError: message.slice(0, 500),
        consecutiveFailures: { increment: 1 },
      },
      select: { consecutiveFailures: true },
    });

    if (updated.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await this.prisma.providerSyncSchedule.update({
        where: { id: scheduleId },
        data: { enabled: false },
      });
      logger.warn(
        { scheduleId, failures: updated.consecutiveFailures },
        'sync schedule disabled after repeated failures',
      );
    }
  }
}

export const syncService = new SyncService();
