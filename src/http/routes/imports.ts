import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { buildProviders } from '../../providers/index.js';
import { getAnalyticsQueue, getImportQueue } from '../../queue/queues.js';
import { requireAuth } from '../auth.js';

const triggerSchema = z.object({
  providerKey: z.string().min(1).optional(),
  since: z.string().datetime().optional(),
});

export async function importRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get('/providers', { preHandler: requireAuth() }, async () => {
    const configured = buildProviders();
    const rows = await prisma.dataProvider.findMany({ orderBy: { key: 'asc' } });

    return configured.map((provider) => ({
      key: provider.key,
      name: provider.name,
      configured: provider.isConfigured(),
      registered: rows.some((row) => row.key === provider.key),
    }));
  });

  app.get('/imports', { preHandler: requireAuth() }, async () =>
    prisma.importRun.findMany({
      include: { provider: { select: { key: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      take: 50,
    }),
  );

  app.post('/imports', { preHandler: requireAuth(['ADMIN']) }, async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const job = await getImportQueue().add('manual-import', parsed.data);
    return reply.code(202).send({ jobId: job.id, queued: true });
  });

  app.post('/analytics/recompute', { preHandler: requireAuth(['ADMIN']) }, async (request, reply) => {
    const body = z.object({ season: z.string().min(1).optional() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });

    const job = await getAnalyticsQueue().add('manual-recompute', body.data);
    return reply.code(202).send({ jobId: job.id, queued: true });
  });
}
