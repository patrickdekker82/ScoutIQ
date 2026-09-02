import Link from 'next/link';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { Card, ConfidenceBadge, DemoBadge, Empty, Stat, Table, Td, Th } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Overview: what is in the database, and what has recently happened to it. */
export default async function OverviewPage() {
  const [
    players,
    teams,
    matches,
    events,
    seasons,
    imports,
    topScores,
    reports,
  ] = await Promise.all([
    prisma.player.count(),
    prisma.team.count(),
    prisma.match.count(),
    prisma.event.count(),
    prisma.competitionSeason.findMany({
      where: { matches: { some: {} } },
      include: {
        competition: { select: { name: true } },
        _count: { select: { matches: true } },
      },
      orderBy: { seasonName: 'desc' },
      take: 6,
    }),
    prisma.dataImport.findMany({
      include: { provider: { select: { key: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      take: 6,
    }),
    prisma.playerRoleScore.findMany({
      where: { isPrimary: true, analyticsVersion: ANALYTICS_VERSION },
      include: {
        player: { select: { id: true, fullName: true, positionGroup: true, isDemo: true } },
        role: { select: { name: true } },
      },
      orderBy: { score: 'desc' },
      take: 8,
    }),
    prisma.report.count(),
  ]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Players" value={players.toLocaleString()} />
        <Stat label="Clubs" value={teams.toLocaleString()} />
        <Stat label="Matches" value={matches.toLocaleString()} />
        <Stat label="Events" value={events.toLocaleString()} />
        <Stat label="Seasons" value={seasons.length} />
        <Stat label="Reports" value={reports} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Highest role fits"
          subtitle="Primary role per player, ranked by fit score"
          className="lg:col-span-2"
        >
          {topScores.length === 0 ? (
            <Empty>
              No analytics yet. Import data, then run{' '}
              <code className="rounded bg-ink-100 px-1">npm run analytics:refresh</code>.
            </Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Player</Th>
                  <Th>Group</Th>
                  <Th>Primary role</Th>
                  <Th align="right">Score</Th>
                  <Th>Confidence</Th>
                </tr>
              </thead>
              <tbody>
                {topScores.map((entry) => (
                  <tr key={entry.id} className="hover:bg-ink-50">
                    <Td>
                      <Link
                        href={`/players/${entry.player.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {entry.player.fullName}
                      </Link>
                      {entry.player.isDemo && <span className="ml-2"><DemoBadge /></span>}
                    </Td>
                    <Td>{entry.player.positionGroup}</Td>
                    <Td>{entry.role.name}</Td>
                    <Td align="right">{entry.score.toFixed(1)}</Td>
                    <Td>
                      <ConfidenceBadge confidence={entry.confidence} minutes={entry.sampleMinutes} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Seasons" subtitle="Competition seasons holding match data">
            {seasons.length === 0 ? (
              <Empty>No seasons imported yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {seasons.map((season) => (
                  <li key={season.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink-700">
                      {season.competition.name}{' '}
                      <span className="text-ink-400">{season.seasonName}</span>
                    </span>
                    <span className="tabular text-xs text-ink-500">
                      {season._count.matches} matches
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent imports" subtitle="Provenance for everything in the database">
            {imports.length === 0 ? (
              <Empty>
                Nothing imported yet. Try{' '}
                <code className="rounded bg-ink-100 px-1">npm run ingest:demo</code>.
              </Empty>
            ) : (
              <ul className="space-y-2">
                {imports.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-ink-700">{entry.provider.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular text-xs text-ink-500">
                        {entry.recordsWritten.toLocaleString()}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          entry.status === 'COMPLETED'
                            ? 'bg-good/10 text-good'
                            : entry.status === 'FAILED'
                              ? 'bg-bad/10 text-bad'
                              : 'bg-ink-100 text-ink-500'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
