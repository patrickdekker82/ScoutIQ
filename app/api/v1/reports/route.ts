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

/**
 * Report generation (§50, §51).
 *
 * One endpoint, four kinds: which subject you name decides which report you
 * get, and the schema refuses a request that names none or more than one.
 */
const schema = z
  .object({
    playerId: z.string().uuid().optional(),
    playerIds: z.array(z.string().uuid()).min(2).max(5).optional(),
    teamId: z.string().uuid().optional(),
    matchId: z.string().uuid().optional(),
    competitionSeasonId: z.string().uuid().optional(),
    title: z.string().min(3).max(200).optional(),
    summary: z.string().max(4000).optional(),
    recommendation: z.string().max(4000).optional(),
    includePdf: z.boolean().default(true),
    /** PDF rendering is slow; queue it unless the caller wants to wait. */
    background: z.boolean().default(true),
  })
  .refine(
    (value) =>
      [value.playerId, value.playerIds, value.teamId, value.matchId].filter(Boolean).length === 1,
    'Name exactly one subject: playerId, playerIds, teamId or matchId',
  );

type Kind = 'player' | 'comparison' | 'club' | 'match';

const kindOf = (body: z.infer<typeof schema>): Kind =>
  body.playerIds ? 'comparison' : body.teamId ? 'club' : body.matchId ? 'match' : 'player';

export const POST = route(async (request: Request) => {
  const user = await requirePermission('reports:create', request);
  const body = await parseBody(request, schema);
  const kind = kindOf(body);

  if (body.background) {
    const job = await reportQueue().add(`${kind}-report`, { ...body, authorId: user.id });
    return json({ jobId: job.id, queued: true, kind }, { status: 202 });
  }

  const { ReportService } = await import('@/server/services/report.service');
  const service = new ReportService();
  const options = { ...body, authorId: user.id };

  const result =
    kind === 'comparison'
      ? await service.generateComparisonReport(options)
      : kind === 'club'
        ? await service.generateClubReport(options)
        : kind === 'match'
          ? await service.generateMatchReport(options)
          : await service.generatePlayerReport({ ...options, type: ReportType.PLAYER });

  return json(result, { status: 201 });
});
