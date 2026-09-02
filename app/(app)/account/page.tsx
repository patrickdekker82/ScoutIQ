import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth';
import { Card } from '@/components/ui';
import { ChangePassword } from '@/components/change-password';

export const dynamic = 'force-dynamic';

/** Self-service account settings - available to every signed-in role (§63). */
export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="space-y-5">
      <Card title="Your account" subtitle="Signed in to a self-hosted ScoutIQ instance">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-ink-500">Name</dt>
            <dd className="text-sm text-ink-900">{user.displayName}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-ink-500">Email</dt>
            <dd className="text-sm text-ink-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-ink-500">Role</dt>
            <dd className="text-sm text-ink-900">{user.role}</dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Change password"
        subtitle="Changing it signs out every other session for your account"
      >
        <ChangePassword />
      </Card>
    </div>
  );
}
