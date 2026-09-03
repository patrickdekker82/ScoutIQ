import { CompareTabs } from '@/components/compare-tabs';
import { ClubCompare } from '@/components/club-compare';

export const dynamic = 'force-dynamic';

/** Club comparison (§44). Clubs are chosen client-side and shared by URL. */
export default async function CompareClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const initialIds = (ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <CompareTabs />
      <ClubCompare initialIds={initialIds} />
    </div>
  );
}
