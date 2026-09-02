import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, parseBody, route } from '@/server/http';
import { isValidCron } from '@/jobs/cron';

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cron: z.string().min(9).max(120).optional(),
  enabled: z.boolean().optional(),
  competitionExternalId: z.string().max(120).nullable().optional(),
  seasonExternalId: z.string().max(120).nullable().optional(),
  includeEvents: z.boolean().optional(),
  includeTracking: z.boolean().optional(),
  matchLimit: z.number().int().min(1).max(1000).nullable().optional(),
  overlapHours: z.number().int().min(0).max(720).optional(),
  /** Set to null to force a full re-sync on the next run. */
  watermark: z.string().datetime().nullable().optional(),
});

export const PATCH = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requirePermission('providers:manage', request);
    const { id } = await context.params;
    const body = await parseBody(request, patchSchema);

    if (body.cron !== undefined && !isValidCron(body.cron)) {
      return apiError(400, 'bad_request', {
        message: 'Not a valid five-field cron expression (minute hour day month weekday).',
      });
    }

    const existing = await prisma.providerSyncSchedule.findUnique({ where: { id } });
    if (!existing) return apiError(404, 'not_found', { message: 'No such sync schedule.' });

    const schedule = await prisma.providerSyncSchedule.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.cron !== undefined ? { cron: body.cron } : {}),
        // Re-enabling clears the failure counter that disabled it.
        ...(body.enabled !== undefined
          ? { enabled: body.enabled, ...(body.enabled ? { consecutiveFailures: 0 } : {}) }
          : {}),
        ...(body.competitionExternalId !== undefined
          ? { competitionExternalId: body.competitionExternalId }
          : {}),
        ...(body.seasonExternalId !== undefined
          ? { seasonExternalId: body.seasonExternalId }
          : {}),
        ...(body.includeEvents !== undefined ? { includeEvents: body.includeEvents } : {}),
        ...(body.includeTracking !== undefined ? { includeTracking: body.includeTracking } : {}),
        ...(body.matchLimit !== undefined ? { matchLimit: body.matchLimit } : {}),
        ...(body.overlapHours !== undefined ? { overlapHours: body.overlapHours } : {}),
        ...(body.watermark !== undefined
          ? { watermark: body.watermark === null ? null : new Date(body.watermark) }
          : {}),
      },
    });

    await audit({
      actorId: admin.id,
      action: 'sync.schedule.update',
      entityType: 'provider_sync_schedule',
      entityId: schedule.id,
      summary: `Updated sync schedule "${schedule.name}"`,
      details: body,
      ip: clientIp(request),
    });

    return json(schedule);
  },
);

export const DELETE = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const admin = await requirePermission('providers:manage', request);
    const { id } = await context.params;

    const existing = await prisma.providerSyncSchedule.findUnique({ where: { id } });
    if (!existing) return apiError(404, 'not_found', { message: 'No such sync schedule.' });

    await prisma.providerSyncSchedule.delete({ where: { id } });

    await audit({
      actorId: admin.id,
      action: 'sync.schedule.delete',
      entityType: 'provider_sync_schedule',
      entityId: id,
      summary: `Deleted sync schedule "${existing.name}"`,
      ip: clientIp(request),
    });

    return json({ deleted: true });
  },
);
