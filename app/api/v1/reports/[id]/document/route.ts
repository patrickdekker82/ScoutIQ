import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { apiError, parseQuery, route } from '@/server/http';
import { ReportService } from '@/server/services/report.service';

type Context = { params: Promise<{ id: string }> };

const querySchema = z.object({
  format: z.enum(['html', 'pdf']).default('html'),
  version: z.coerce.number().int().min(1).optional(),
});

/**
 * Serve a rendered report.
 *
 * Reads the stored artifact when it exists; otherwise re-renders from the
 * frozen snapshot, which reproduces the original exactly (§52).
 */
export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;
  const query = parseQuery(request, querySchema);

  const version = await prisma.reportVersion.findFirst({
    where: { reportId: id, ...(query.version ? { version: query.version } : {}) },
    orderBy: { version: 'desc' },
  });

  if (!version) return apiError(404, 'not_found');

  const service = new ReportService();
  const stored = await service.readArtifact(version.id, query.format);

  if (stored) {
    return new Response(new Uint8Array(stored), {
      headers: {
        'content-type': query.format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8',
        'content-disposition':
          query.format === 'pdf'
            ? `inline; filename="scoutiq-report-${id}.pdf"`
            : 'inline',
      },
    });
  }

  if (query.format === 'pdf') {
    return apiError(404, 'not_found', {
      message: 'No PDF was generated for this version. Re-generate the report with PDF enabled.',
    });
  }

  const html = await service.renderStoredVersion(version.id);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
});
