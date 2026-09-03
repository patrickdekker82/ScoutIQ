import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { Card, DemoBadge, Empty, Stat, Table, Td, Th } from '@/components/ui';
import { ShotMap } from '@/components/pitch';
import { EventBrowser } from '@/components/event-browser';
import { PassingNetworkPanel } from '@/components/passing-network-panel';
import { GenerateReportButton } from '@/components/generate-report';
import { can, getSessionUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

/** Match page (§40) with the event browser of §89. */
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: { select: { id: true, name: true } },
      awayTeam: { select: { id: true, name: true } },
      season: { include: { competition: { select: { name: true } } } },
      venue: { select: { name: true } },
      matchTeams: true,
    },
  });
  if (!match) notFound();

  const [teamMetrics, lineups, shots] = await Promise.all([
    prisma.teamMatchMetric.findMany({
      where: { matchId: id, analyticsVersion: ANALYTICS_VERSION },
    }),
    prisma.playerMatch.findMany({
      where: { matchId: id },
      include: { player: { select: { id: true, fullName: true } } },
      orderBy: [{ isStarter: 'desc' }, { minutesPlayed: 'desc' }],
    }),
    prisma.event.findMany({
      where: { matchId: id, type: 'SHOT', x: { not: null } },
      select: {
        id: true,
        x: true,
        y: true,
        minute: true,
        teamId: true,
        shot: true,
        player: { select: { fullName: true } },
      },
    }),
  ]);

  const home = teamMetrics.find((metric) => metric.teamId === match.homeTeamId);
  const away = teamMetrics.find((metric) => metric.teamId === match.awayTeamId);

  const comparison: [string, number | null | undefined, number | null | undefined, number][] = [
    ['Possession', home?.possession, away?.possession, 1],
    ['xG', home?.xg, away?.xg, 2],
    ['Shots', home?.shots, away?.shots, 0],
    ['Shots on target', home?.shotsOnTarget, away?.shotsOnTarget, 0],
    ['Passes', home?.passes, away?.passes, 0],
    ['Pass accuracy %', (home?.passAccuracy ?? 0) * 100, (away?.passAccuracy ?? 0) * 100, 1],
    ['Progressive passes', home?.progressivePasses, away?.progressivePasses, 0],
    ['Final third entries', home?.finalThirdEntries, away?.finalThirdEntries, 0],
    ['Box entries', home?.boxEntries, away?.boxEntries, 0],
    ['Field tilt %', home?.fieldTilt, away?.fieldTilt, 1],
    ['Pressures', home?.pressures, away?.pressures, 0],
    ['Recoveries', home?.recoveries, away?.recoveries, 0],
    ['PPDA', home?.ppda, away?.ppda, 1],
  ];

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-ink-500">
          {match.season.competition.name} {match.season.seasonName}
          {match.venue?.name && ` · ${match.venue.name}`} ·{' '}
          {match.kickoffAt.toISOString().slice(0, 10)}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            <Link href={`/teams/${match.homeTeamId}`} className="hover:text-brand-600">
              {match.homeTeam.name}
            </Link>
            <span className="mx-3 tabular text-ink-500">
              {match.homeScore ?? '-'} : {match.awayScore ?? '-'}
            </span>
            <Link href={`/teams/${match.awayTeamId}`} className="hover:text-brand-600">
              {match.awayTeam.name}
            </Link>
          </h1>
          {match.isDemo && <DemoBadge />}
          {user && can(user.role, 'reports:create') && (
            <div className="ml-auto">
              <GenerateReportButton matchId={match.id} label="Match report" />
            </div>
          )}
        </div>
      </header>

      {home && away ? (
        <Card title="Team comparison">
          <Table>
            <thead>
              <tr>
                <Th align="right">{match.homeTeam.name}</Th>
                <Th>Metric</Th>
                <Th align="right">{match.awayTeam.name}</Th>
              </tr>
            </thead>
            <tbody>
              {comparison.map(([label, homeValue, awayValue, decimals]) => (
                <tr key={label}>
                  <Td align="right" className="font-medium">
                    {typeof homeValue === 'number' ? homeValue.toFixed(decimals) : '-'}
                  </Td>
                  <Td className="text-center text-ink-500">{label}</Td>
                  <Td align="right" className="font-medium">
                    {typeof awayValue === 'number' ? awayValue.toFixed(decimals) : '-'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Empty>
          No team metrics for this match yet - run{' '}
          <code className="rounded bg-ink-100 px-1">npm run analytics:refresh</code>.
        </Empty>
      )}

      <PassingNetworkPanel
        matchId={match.id}
        teams={[
          { id: match.homeTeamId, name: match.homeTeam.name },
          { id: match.awayTeamId, name: match.awayTeam.name },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Shot map" subtitle={`${shots.length} shots`}>
          {shots.length === 0 ? (
            <Empty>No shots recorded.</Empty>
          ) : (
            <ShotMap
              shots={shots.map((shot) => ({
                id: shot.id,
                // No mirroring: canonical coordinates already have both teams
                // attacking left-to-right (§33). Flipping the away side would
                // put its shots in its own defensive third - outside this map.
                x: shot.x as number,
                y: shot.y as number,
                side: shot.teamId === match.homeTeamId ? ('home' as const) : ('away' as const),
                teamName:
                  shot.teamId === match.homeTeamId ? match.homeTeam.name : match.awayTeam.name,
                xg: shot.shot?.xg ?? 0,
                isGoal: shot.shot?.isGoal ?? false,
                onTarget: shot.shot?.onTarget ?? false,
                minute: shot.minute,
                playerName: shot.player?.fullName ?? null,
              }))}
            />
          )}
        </Card>

        <Card title="Lineups" subtitle={`${lineups.length} appearances`}>
          <Table>
            <thead>
              <tr>
                <Th>Player</Th>
                <Th>Pos</Th>
                <Th align="right">Min</Th>
              </tr>
            </thead>
            <tbody>
              {lineups.slice(0, 30).map((entry) => (
                <tr key={entry.id}>
                  <Td>
                    <Link
                      href={`/players/${entry.playerId}`}
                      className="text-brand-600 hover:underline"
                    >
                      {entry.player.fullName}
                    </Link>
                    {!entry.isStarter && <span className="ml-1 text-xs text-ink-400">(sub)</span>}
                  </Td>
                  <Td>{entry.position ?? '-'}</Td>
                  <Td align="right">{entry.minutesPlayed}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <EventBrowser matchId={id} />
    </div>
  );
}
