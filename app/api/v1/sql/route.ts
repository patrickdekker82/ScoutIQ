import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { json, parseBody, route } from '@/server/http';
import { SqlService } from '@/server/services/sql.service';

const schema = z.object({
  sql: z.string().min(1).max(20_000),
  save: z.object({ name: z.string().min(1).max(120), description: z.string().optional() }).optional(),
});

/** SQL analyst interface (§23). Analyst/Admin only, SELECT only. */
export const POST = route(async (request: Request) => {
  const user = await requirePermission('sql:read', request);
  const body = await parseBody(request, schema);

  const service = new SqlService();
  const result = await service.execute(body.sql, user.id);

  if (body.save) {
    await service.saveQuery(user.id, body.save.name, body.sql, body.save.description);
  }

  await audit({
    actorId: user.id,
    action: 'sql.execute',
    summary: `Executed a query returning ${result.rowCount} rows`,
    details: { durationMs: result.durationMs, truncated: result.truncated },
    ip: clientIp(request),
  });

  return json(result);
});

export const GET = route(async (request: Request) => {
  const user = await requirePermission('sql:read', request);
  const service = new SqlService();

  const [history, saved] = await Promise.all([
    service.history(user.id),
    service.savedQueries(user.id),
  ]);

  return json({ history, saved });
});
