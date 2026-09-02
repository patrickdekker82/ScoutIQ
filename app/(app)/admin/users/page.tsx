import { redirect } from 'next/navigation';
import { prisma } from '@/db/client';
import { can, getSessionUser } from '@/server/auth';
import { Card } from '@/components/ui';
import { UserAdmin, type AdminUserRow } from '@/components/user-admin';
import { ChangePassword } from '@/components/change-password';

export const dynamic = 'force-dynamic';

/** User administration (§63). Admin only; the API enforces the same rule. */
export default async function UsersAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!can(user.role, 'users:manage')) redirect('/');

  const [rows, recentAudit] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
        lastLoginAt: true,
        createdAt: true,
        _count: { select: { reports: true, notes: true, shortlists: true } },
      },
      orderBy: [{ active: 'desc' }, { displayName: 'asc' }],
    }),
    prisma.auditLog.findMany({
      where: { entityType: 'user' },
      include: { actor: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);

  const users: AdminUserRow[] = rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    active: row.active,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    counts: {
      reports: row._count.reports,
      notes: row._count.notes,
      shortlists: row._count.shortlists,
    },
  }));

  const admins = users.filter((row) => row.active && row.role === 'ADMIN').length;

  return (
    <div className="space-y-5">
      <Card
        title="Users"
        subtitle={`${users.length} accounts, ${admins} active administrator${admins === 1 ? '' : 's'} (§63)`}
      >
        <UserAdmin users={users} selfId={user.id} />
      </Card>

      <Card
        title="Your password"
        subtitle="Changing it signs out every other session for your account"
      >
        <ChangePassword />
      </Card>

      <Card title="Recent account changes" subtitle="From the audit trail (§65)">
        {recentAudit.length === 0 ? (
          <p className="text-sm text-ink-500">No account changes have been recorded yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {recentAudit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2 text-ink-700">
                <span className="tabular text-xs text-ink-400">
                  {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </span>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-400">
                  {entry.action}
                </span>
                <span>{entry.summary}</span>
                <span className="text-xs text-ink-400">
                  by {entry.actor?.displayName ?? 'system'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
