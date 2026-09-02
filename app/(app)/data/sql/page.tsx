import { redirect } from 'next/navigation';
import { can, getSessionUser } from '@/server/auth';
import { SqlConsole } from '@/components/sql-console';
import { prisma } from '@/db/client';

export const dynamic = 'force-dynamic';

/** SQL analyst interface (§23). Analyst and Admin only. */
export default async function SqlPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!can(user.role, 'sql:read')) redirect('/');

  const [history, saved] = await Promise.all([
    prisma.queryHistory.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.savedQuery.findMany({
      where: { OR: [{ ownerId: user.id }, { isShared: true }] },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return (
    <SqlConsole
      history={history.map((entry) => ({
        id: entry.id,
        sql: entry.sql,
        rowCount: entry.rowCount,
        durationMs: entry.durationMs,
        success: entry.success,
      }))}
      saved={saved.map((entry) => ({ id: entry.id, name: entry.name, sql: entry.sql }))}
    />
  );
}
