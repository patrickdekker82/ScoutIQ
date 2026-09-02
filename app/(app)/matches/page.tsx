import Link from 'next/link';
import { prisma } from '@/db/client';
import { Card, DemoBadge, Empty, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function MatchesPage() {
  const matches = await prisma.match.findMany({
    include: {
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
      season: { include: { competition: { select: { name: true } } } },
      _count: { select: { events: true } },
    },
    orderBy: { kickoffAt: 'desc' },
    take: 100,
  });

  return (
    <Card title="Matches" subtitle={`${matches.length} most recent`}>
      {matches.length === 0 ? (
        <Empty>No matches imported yet.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Competition</Th>
              <Th>Fixture</Th>
              <Th align="right">Score</Th>
              <Th align="right">Events</Th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => (
              <tr key={match.id} className="hover:bg-ink-50">
                <Td>{match.kickoffAt.toISOString().slice(0, 10)}</Td>
                <Td>
                  {match.season.competition.name}{' '}
                  <span className="text-ink-400">{match.season.seasonName}</span>
                </Td>
                <Td>
                  <Link href={`/matches/${match.id}`} className="text-brand-600 hover:underline">
                    {match.homeTeam.name} v {match.awayTeam.name}
                  </Link>
                  {match.isDemo && (
                    <span className="ml-2">
                      <DemoBadge />
                    </span>
                  )}
                </Td>
                <Td align="right">
                  {match.homeScore !== null ? `${match.homeScore}-${match.awayScore}` : '-'}
                </Td>
                <Td align="right">{match._count.events.toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
