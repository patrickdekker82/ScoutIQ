import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, parseBody, route } from '@/server/http';
import { syncService } from '@/server/services/sync.service';
import { isValidCron } from '@/jobs/cron';

/** External API synchronisation schedules (§88 phase 8). Admin only. */
export const GET = route(async (request: Request) => {
  await requirePermission('providers:manage', request);
  return json(await syncService.listSchedules());
});

const createSchema = z.object({
  providerKey: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  cron: z.string().min(9).max(120),
  competitionExternalId: z.string().max(120).optional(),
  seasonExternalId: z.string().max(120).optional(),
  includeEvents: z.boolean().default(true),
  includeTracking: z.boolean().default(false),
  matchLimit: z.number().int().min(1).max(1000).optional(),
  overlapHours: z.number().int().min(0).max(720).default(24),
});

export const POST = route(async (request: Request) => {
  const admin = await requirePermission('providers:manage', request);
  const body = await parseBody(request, createSchema);

  if (!isValidCron(body.cron)) {
    return apiError(400, 'bad_request', {
      message: 'Not a valid five-field cron expression (minute hour day month weekday).',
    });
  }

  const provider = await prisma.provider.findUnique({ where: { key: body.providerKey } });
  if (!provider) {
    return apiError(404, 'not_found', { message: `No provider registered as ${body.providerKey}` });
  }

  const existing = await prisma.providerSyncSchedule.findFirst({
    where: { providerId: provider.id, name: body.name },
  });
  if (existing) {
    return apiError(409, 'conflict', {
      message: 'That provider already has a schedule with this name.',
    });
  }

  const schedule = await prisma.providerSyncSchedule.create({
    data: {
      providerId: provider.id,
      name: body.name,
      cron: body.cron,
      ...(body.competitionExternalId ? { competitionExternalId: body.competitionExternalId } : {}),
      ...(body.seasonExternalId ? { seasonExternalId: body.seasonExternalId } : {}),
      includeEvents: body.includeEvents,
      includeTracking: body.includeTracking,
      ...(body.matchLimit ? { matchLimit: body.matchLimit } : {}),
      overlapHours: body.overlapHours,
      createdById: admin.id,
    },
  });

  await audit({
    actorId: admin.id,
    action: 'sync.schedule.create',
    entityType: 'provider_sync_schedule',
    entityId: schedule.id,
    summary: `Created sync schedule "${schedule.name}" for ${provider.key} (${schedule.cron})`,
    ip: clientIp(request),
  });

  return json(schedule, { status: 201 });
});
