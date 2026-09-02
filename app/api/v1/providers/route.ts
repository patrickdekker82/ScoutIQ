import { prisma } from '@/db/client';
import { describeProviders } from '@/providers';
import { requirePermission } from '@/server/auth';
import { json, route } from '@/server/http';

/**
 * Provider registry with licensing (§13, §55).
 *
 * Licence terms are part of the response on purpose: an analyst deciding
 * whether to export a dataset should see, in the same place, whether
 * redistribution is permitted.
 */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);

  const [registry, rows] = await Promise.all([
    describeProviders(),
    prisma.provider.findMany({
      include: {
        versions: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { imports: true, datasets: true } },
        imports: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
    }),
  ]);

  const byKey = new Map(rows.map((row) => [row.key, row]));

  return json(
    registry.map((provider) => {
      const row = byKey.get(provider.key);
      return {
        ...provider,
        registered: Boolean(row),
        importCount: row?._count.imports ?? 0,
        datasetCount: row?._count.datasets ?? 0,
        lastImport: row?.imports[0]
          ? {
              id: row.imports[0].id,
              status: row.imports[0].status,
              startedAt: row.imports[0].startedAt,
              finishedAt: row.imports[0].finishedAt,
              recordsWritten: row.imports[0].recordsWritten,
            }
          : null,
      };
    }),
  );
});
