import { z } from 'zod';
import { ALL_QUEUES, queueCounts, recentJobs } from '@/jobs/queues';
import { listSchedules } from '@/jobs/scheduler';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';

const querySchema = z.object({
  queue: z.enum(ALL_QUEUES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Job dashboard (§57) and the registered schedules (§58). */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const [counts, schedules] = await Promise.all([queueCounts(), listSchedules()]);

  const jobs = query.queue
    ? await recentJobs(query.queue, query.limit)
    : (
        await Promise.all(ALL_QUEUES.map((queue) => recentJobs(queue, 10)))
      ).flat();

  return json({ counts, jobs, schedules });
});
