import { CompareTabs } from '@/components/compare-tabs';
import { can, getSessionUser } from '@/server/auth';
import { PlayerCompare } from '@/components/player-compare';

export const dynamic = 'force-dynamic';

/** Player comparison (§43). Players are chosen client-side and shared by URL. */
export default async function ComparePlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const user = await getSessionUser();
  const initialIds = (ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <CompareTabs />
      <PlayerCompare
        initialIds={initialIds}
        canReport={Boolean(user && can(user.role, 'reports:create'))}
      />
    </div>
  );
}
