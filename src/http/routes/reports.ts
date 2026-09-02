import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { ReportService } from '../../services/report.service.js';
import { requireAuth } from '../auth.js';

const createSchema = z.object({
  playerId: z.string().uuid(),
  title: z.string().min(3).max(200),
  summary: z.string().min(10),
  rating: z.number().int().min(1).max(10),
  season: z.string().min(1).optional(),
  publish: z.boolean().optional(),
});

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();
  const reports = new ReportService();

  app.get('/reports', { preHandler: requireAuth() }, async () =>
    prisma.scoutingReport.findMany({
      include: {
        player: { select: { id: true, firstName: true, lastName: true, position: true } },
        author: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );

  app.post('/reports', { preHandler: requireAuth(['ADMIN', 'SCOUT']) }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    try {
      const report = await reports.create({ ...parsed.data, authorId: request.user!.sub });
      return reply.code(201).send(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Unknown player')) return reply.code(404).send({ error: 'not_found' });
      throw error;
    }
  });

  app.get('/reports/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const report = await prisma.scoutingReport.findUnique({
      where: { id },
      include: { player: true, author: { select: { id: true, displayName: true } } },
    });
    if (!report) return reply.code(404).send({ error: 'not_found' });
    return report;
  });

  /** Rendered document, streamed from REPORT_ROOT (wherever that is mounted). */
  app.get('/reports/:id/document', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const document = await reports.readDocument(id);
    if (document === null) return reply.code(404).send({ error: 'not_found' });
    return reply.type('text/markdown; charset=utf-8').send(document);
  });
}
