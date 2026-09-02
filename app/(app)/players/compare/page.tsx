import { PlayerCompare } from '@/components/player-compare';

export const dynamic = 'force-dynamic';

/** Player comparison (§43). Players are chosen client-side and shared by URL. */
export default async function ComparePlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const initialIds = (ids ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return <PlayerCompare initialIds={initialIds} />;
}
