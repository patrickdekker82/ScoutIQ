import { z } from 'zod';
import { analyticsQueue } from '@/jobs/queues';
import { requirePermission } from '@/server/auth';
import { audit } from '@/server/audit';
import { json, parseBody, route } from '@/server/http';

const schema = z.object({
  competitionSeasonId: z.string().uuid().optional(),
  refreshMaterializedViews: z.boolean().optional(),
});

export const POST = route(async (request: Request) => {
  const user = await requirePermission('analytics:run', request);
  const body = await parseBody(request, schema);

  const job = await analyticsQueue().add('manual-recompute', body);

  await audit({
    actorId: user.id,
    action: 'analytics.refresh',
    summary: 'Queued an analytics recompute',
    details: body,
  });

  return json({ jobId: job.id, queued: true }, { status: 202 });
});
