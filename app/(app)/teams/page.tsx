import Link from 'next/link';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { Card, ConfidenceBadge, DemoBadge, Empty, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    include: {
      country: { select: { name: true } },
      seasonMetrics: {
        where: { analyticsVersion: ANALYTICS_VERSION },
        orderBy: { matches: 'desc' },
        take: 1,
      },
      _count: { select: { memberships: true } },
    },
    orderBy: { name: 'asc' },
    take: 200,
  });

  return (
    <Card title="Clubs" subtitle={`${teams.length} clubs`}>
      {teams.length === 0 ? (
        <Empty>No clubs imported yet.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Club</Th>
              <Th>Country</Th>
              <Th align="right">Squad</Th>
              <Th align="right">Matches</Th>
              <Th align="right">Possession</Th>
              <Th align="right">xG /90</Th>
              <Th align="right">PPDA</Th>
              <Th>Data</Th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team) => {
              const metrics = team.seasonMetrics[0];
              return (
                <tr key={team.id} className="hover:bg-ink-50">
                  <Td>
                    <Link
                      href={`/teams/${team.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {team.name}
                    </Link>
                    {team.isDemo && (
                      <span className="ml-2">
                        <DemoBadge />
                      </span>
                    )}
                  </Td>
                  <Td>{team.country?.name ?? '-'}</Td>
                  <Td align="right">{team._count.memberships}</Td>
                  <Td align="right">{metrics?.matches ?? '-'}</Td>
                  <Td align="right">
                    {metrics ? `${metrics.possession.toFixed(1)}%` : '-'}
                  </Td>
                  <Td align="right">{metrics ? metrics.xgP90.toFixed(2) : '-'}</Td>
                  <Td align="right">{metrics?.ppda ? metrics.ppda.toFixed(1) : '-'}</Td>
                  <Td>
                    {metrics && <ConfidenceBadge confidence={metrics.confidence} matches={metrics.matches} />}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
