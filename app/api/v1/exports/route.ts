import { z } from 'zod';
import { exportQueue } from '@/jobs/queues';
import { getStorage } from '@/lib/storage';
import { requirePermission } from '@/server/auth';
import { json, parseBody, route } from '@/server/http';
import { DATASETS, ExportService } from '@/server/services/export.service';

const schema = z.object({
  dataset: z.enum(Object.keys(DATASETS) as [string, ...string[]]).optional(),
  sql: z.string().max(20_000).optional(),
  format: z.enum(['csv', 'json', 'sql']).default('csv'),
  name: z.string().max(120).optional(),
  /** Large exports should be queued rather than awaited (§78). */
  background: z.boolean().default(false),
});

export const GET = route(async (request: Request) => {
  await requirePermission('exports:create', request);
  const storage = getStorage();
  const files = await storage.list('exports');

  return json({
    datasets: Object.keys(DATASETS),
    files: await Promise.all(
      files.map(async (name) => ({
        name,
        bytes: await storage.size('exports', name).catch(() => 0),
      })),
    ),
  });
});

export const POST = route(async (request: Request) => {
  const user = await requirePermission('exports:create', request);
  const body = await parseBody(request, schema);

  if (body.background) {
    const job = await exportQueue().add('manual-export', {
      ...(body.dataset ? { dataset: body.dataset } : {}),
      ...(body.sql ? { sql: body.sql } : {}),
      ...(body.name ? { name: body.name } : {}),
      format: body.format,
      requestedById: user.id,
    });
    return json({ jobId: job.id, queued: true }, { status: 202 });
  }

  const result = await new ExportService().run({
    ...(body.dataset ? { dataset: body.dataset } : {}),
    ...(body.sql ? { sql: body.sql } : {}),
    ...(body.name ? { name: body.name } : {}),
    format: body.format,
  });

  return json(result);
});
