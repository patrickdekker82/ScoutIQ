import { ReportType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { reportQueue } from '@/jobs/queues';
import { requirePermission } from '@/server/auth';
import { json, parseBody, route } from '@/server/http';

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);

  const reports = await prisma.report.findMany({
    include: {
      author: { select: { displayName: true } },
      player: { select: { id: true, fullName: true } },
      team: { select: { id: true, name: true } },
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: {
          id: true,
          version: true,
          generatedAt: true,
          analyticsVersion: true,
          dataSnapshotId: true,
          pdfPath: true,
          htmlPath: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return json(reports);
});

const schema = z.object({
  playerId: z.string().uuid(),
  competitionSeasonId: z.string().uuid().optional(),
  title: z.string().min(3).max(200).optional(),
  summary: z.string().max(4000).optional(),
  recommendation: z.string().max(4000).optional(),
  includePdf: z.boolean().default(true),
  /** PDF rendering is slow; queue it unless the caller wants to wait. */
  background: z.boolean().default(true),
});

export const POST = route(async (request: Request) => {
  const user = await requirePermission('reports:create', request);
  const body = await parseBody(request, schema);

  if (body.background) {
    const job = await reportQueue().add('player-report', { ...body, authorId: user.id });
    return json({ jobId: job.id, queued: true }, { status: 202 });
  }

  const { ReportService } = await import('@/server/services/report.service');
  const result = await new ReportService().generatePlayerReport({
    ...body,
    type: ReportType.PLAYER,
    authorId: user.id,
  });

  return json(result, { status: 201 });
});
