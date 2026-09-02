import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, route } from '@/server/http';
import { importQueue } from '@/jobs/queues';
import { syncService } from '@/server/services/sync.service';

/**
 * Run one sync schedule now (§88 phase 8).
 *
 * The work is queued rather than done in the request: a season sync can take
 * minutes, and a request that long would time out behind any reverse proxy.
 */
export const POST = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requirePermission('providers:manage', request);
    const { id } = await context.params;

    const schedule = await prisma.providerSyncSchedule.findUnique({
      where: { id },
      include: { provider: { select: { key: true, enabled: true } } },
    });
    if (!schedule) return apiError(404, 'not_found', { message: 'No such sync schedule.' });
    if (!schedule.provider.enabled) {
      return apiError(409, 'conflict', { message: 'That provider is disabled.' });
    }

    const since = syncService.windowStart(schedule);

    const job = await importQueue().add('sync-schedule', {
      providerKey: schedule.provider.key,
      syncScheduleId: schedule.id,
      ...(schedule.competitionExternalId
        ? { competitionExternalId: schedule.competitionExternalId }
        : {}),
      ...(schedule.seasonExternalId ? { seasonExternalId: schedule.seasonExternalId } : {}),
      ...(schedule.matchLimit ? { matchLimit: schedule.matchLimit } : {}),
      ...(since ? { since: since.toISOString() } : {}),
      includeEvents: schedule.includeEvents,
      includeTracking: schedule.includeTracking,
      requestedById: admin.id,
    });

    await audit({
      actorId: admin.id,
      action: 'sync.schedule.run',
      entityType: 'provider_sync_schedule',
      entityId: schedule.id,
      summary: `Queued a manual run of sync schedule "${schedule.name}"`,
      ip: clientIp(request),
    });

    return json({ jobId: job.id, since: since?.toISOString() ?? null }, { status: 202 });
  },
);
