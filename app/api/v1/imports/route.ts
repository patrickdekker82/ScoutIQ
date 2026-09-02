import { z } from 'zod';
import { prisma } from '@/db/client';
import { importQueue } from '@/jobs/queues';
import { PROVIDER_KEYS } from '@/providers';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { json, parseBody, route } from '@/server/http';

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);

  const imports = await prisma.dataImport.findMany({
    include: {
      provider: { select: { key: true, name: true } },
      providerVersion: { select: { version: true } },
      requestedBy: { select: { displayName: true } },
      _count: { select: { errors: true } },
    },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });

  return json(imports);
});

const triggerSchema = z.object({
  providerKey: z.enum(['all', ...PROVIDER_KEYS] as [string, ...string[]]),
  competitionExternalId: z.string().optional(),
  seasonExternalId: z.string().optional(),
  matchLimit: z.number().int().min(1).max(2000).optional(),
  includeEvents: z.boolean().optional(),
  includeTracking: z.boolean().optional(),
  since: z.string().datetime().optional(),
});

/** Queue an import (§56). Heavy work never runs in the request. */
export const POST = route(async (request: Request) => {
  const user = await requirePermission('imports:run', request);
  const body = await parseBody(request, triggerSchema);

  const job = await importQueue().add('manual-import', {
    ...body,
    requestedById: user.id,
  });

  await audit({
    actorId: user.id,
    action: 'import.start',
    entityType: 'provider',
    entityId: body.providerKey,
    summary: `Queued import from ${body.providerKey}`,
    details: body,
    ip: clientIp(request),
  });

  return json({ jobId: job.id, queued: true }, { status: 202 });
});
