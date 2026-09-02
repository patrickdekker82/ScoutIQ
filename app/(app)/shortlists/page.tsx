import Link from 'next/link';
import { prisma } from '@/db/client';
import { getSessionUser } from '@/server/auth';
import { Card, Empty, Table, Td, Th } from '@/components/ui';
import { NewShortlistForm } from '@/components/new-shortlist';

export const dynamic = 'force-dynamic';

/** Shortlists (§47). */
export default async function ShortlistsPage() {
  const user = await getSessionUser();

  const shortlists = await prisma.shortlist.findMany({
    where: { archived: false },
    include: {
      owner: { select: { displayName: true } },
      season: { include: { competition: { select: { name: true } } } },
      _count: { select: { players: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return (
    <div className="space-y-5">
      <Card title="New shortlist">
        <NewShortlistForm />
      </Card>

      <Card title="Shortlists" subtitle={`${shortlists.length} active`}>
        {shortlists.length === 0 ? (
          <Empty>No shortlists yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Owner</Th>
                <Th>Season</Th>
                <Th align="right">Players</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {shortlists.map((shortlist) => (
                <tr key={shortlist.id} className="hover:bg-ink-50">
                  <Td>
                    <Link
                      href={`/shortlists/${shortlist.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {shortlist.name}
                    </Link>
                    {shortlist.ownerId === user?.id && (
                      <span className="ml-2 text-[11px] text-ink-400">yours</span>
                    )}
                  </Td>
                  <Td>{shortlist.owner.displayName}</Td>
                  <Td>
                    {shortlist.season
                      ? `${shortlist.season.competition.name} ${shortlist.season.seasonName}`
                      : '-'}
                  </Td>
                  <Td align="right">{shortlist._count.players}</Td>
                  <Td>{shortlist.updatedAt.toISOString().slice(0, 10)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
