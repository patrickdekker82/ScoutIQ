import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { Card, ConfidenceBadge, Empty, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  NEW: 'bg-ink-100 text-ink-600',
  WATCHING: 'bg-brand-50 text-brand-700',
  SCOUTED: 'bg-brand-100 text-brand-700',
  INTERESTED: 'bg-warn/15 text-warn',
  PRIORITY: 'bg-good/15 text-good',
  REJECTED: 'bg-bad/10 text-bad',
  SIGNED: 'bg-good/20 text-good',
};

export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const shortlist = await prisma.shortlist.findUnique({
    where: { id },
    include: {
      owner: { select: { displayName: true } },
      players: {
        include: {
          player: {
            select: {
              id: true,
              fullName: true,
              primaryPosition: true,
              dateOfBirth: true,
              seasonMetrics: {
                where: { analyticsVersion: ANALYTICS_VERSION },
                orderBy: { minutes: 'desc' },
                take: 1,
              },
            },
          },
        },
        orderBy: [{ priority: 'asc' }, { addedAt: 'desc' }],
      },
    },
  });

  if (!shortlist) notFound();

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{shortlist.name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {shortlist.description ?? 'No description'} · owned by {shortlist.owner.displayName}
        </p>
      </header>

      <Card title="Players" subtitle={`${shortlist.players.length} on the list`}>
        {shortlist.players.length === 0 ? (
          <Empty>
            No players yet. Open a player and add them, or use the API endpoint{' '}
            <code className="rounded bg-ink-100 px-1">PUT /api/v1/shortlists</code>.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Player</Th>
                <Th>Pos</Th>
                <Th align="right">Age</Th>
                <Th>Status</Th>
                <Th align="right">Priority</Th>
                <Th align="right">Scout rating</Th>
                <Th align="right">Minutes</Th>
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {shortlist.players.map((entry) => {
                const metrics = entry.player.seasonMetrics[0];
                return (
                  <tr key={entry.id} className="hover:bg-ink-50">
                    <Td>
                      <Link
                        href={`/players/${entry.playerId}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {entry.player.fullName}
                      </Link>
                    </Td>
                    <Td>{entry.player.primaryPosition}</Td>
                    <Td align="right">
                      {entry.player.dateOfBirth
                        ? Math.floor(
                            (Date.now() - entry.player.dateOfBirth.getTime()) / (365.25 * 864e5),
                          )
                        : '-'}
                    </Td>
                    <Td>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          STATUS_TONE[entry.status] ?? 'bg-ink-100 text-ink-600'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </Td>
                    <Td align="right">{entry.priority}</Td>
                    <Td align="right">{entry.scoutRating ?? '-'}</Td>
                    <Td align="right">{metrics?.minutes ?? '-'}</Td>
                    <Td>{metrics && <ConfidenceBadge confidence={metrics.confidence} />}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
