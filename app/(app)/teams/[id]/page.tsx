import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { STYLE_DIMENSIONS, STYLE_LABELS } from '@/analytics/team-style';
import { prisma } from '@/db/client';
import { Card, ConfidenceBadge, DemoBadge, Empty, PercentileBar, Stat, Table, Td, Th } from '@/components/ui';
import { DnaRadar } from '@/components/radar';

export const dynamic = 'force-dynamic';

/** Club page (§41). */
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: { country: { select: { name: true } } },
  });
  if (!team) notFound();

  const [style, seasonMetric, squad, matches] = await Promise.all([
    prisma.teamStyleProfile.findFirst({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { season: { include: { competition: { select: { name: true } } } } },
      orderBy: { computedAt: 'desc' },
    }),
    prisma.teamSeasonMetric.findFirst({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { season: { include: { competition: { select: { name: true } } } } },
      orderBy: { matches: 'desc' },
    }),
    prisma.playerSeasonMetric.findMany({
      where: { teamId: id, analyticsVersion: ANALYTICS_VERSION },
      include: {
        player: {
          select: { id: true, fullName: true, primaryPosition: true, positionGroup: true, dateOfBirth: true },
        },
      },
      orderBy: { minutes: 'desc' },
    }),
    prisma.match.findMany({
      where: { OR: [{ homeTeamId: id }, { awayTeamId: id }] },
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
      },
      orderBy: { kickoffAt: 'desc' },
      take: 20,
    }),
  ]);

  const dimensions = (style?.style as Record<string, number> | undefined) ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{team.name}</h1>
        {team.isDemo && <DemoBadge />}
        <span className="text-sm text-ink-500">{team.country?.name}</span>
        {seasonMetric && (
          <ConfidenceBadge confidence={seasonMetric.confidence} matches={seasonMetric.matches} />
        )}
        <Link
          href={`/teams/compare?ids=${team.id}`}
          className="ml-auto rounded-md border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
        >
          Compare
        </Link>
      </header>

      {seasonMetric && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Matches" value={seasonMetric.matches} />
          <Stat label="Possession" value={`${seasonMetric.possession.toFixed(1)}%`} />
          <Stat label="xG /90" value={seasonMetric.xgP90.toFixed(2)} />
          <Stat label="xG against /90" value={seasonMetric.xgAgainstP90.toFixed(2)} />
          <Stat label="Shots /90" value={seasonMetric.shotsP90.toFixed(1)} />
          <Stat label="Field tilt" value={`${seasonMetric.fieldTilt.toFixed(1)}%`} />
          <Stat label="PPDA" value={seasonMetric.ppda ? seasonMetric.ppda.toFixed(1) : '-'} />
          <Stat label="Directness" value={seasonMetric.directness.toFixed(1)} />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Tactical style"
          subtitle={
            style
              ? `${style.season.competition.name} ${style.season.seasonName}, ranked within the competition`
              : undefined
          }
        >
          {dimensions ? (
            <DnaRadar
              axes={STYLE_DIMENSIONS.filter((dimension) => dimensions[dimension] !== undefined).map(
                (dimension) => ({
                  category: STYLE_LABELS[dimension] ?? dimension,
                  score: dimensions[dimension] as number,
                }),
              )}
            />
          ) : (
            <Empty>No style profile computed.</Empty>
          )}
        </Card>

        <Card title="Style dimensions" subtitle="Percentile within the competition" className="lg:col-span-2">
          {dimensions ? (
            <Table>
              <thead>
                <tr>
                  <Th>Dimension</Th>
                  <Th>Score</Th>
                </tr>
              </thead>
              <tbody>
                {STYLE_DIMENSIONS.map((dimension) => (
                  <tr key={dimension}>
                    <Td>{STYLE_LABELS[dimension] ?? dimension}</Td>
                    <Td>
                      <PercentileBar percentile={dimensions[dimension] ?? 0} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No style profile computed.</Empty>
          )}
        </Card>
      </div>

      <Card title="Squad" subtitle={`${squad.length} players with minutes this season`}>
        {squad.length === 0 ? (
          <Empty>No squad data.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Player</Th>
                <Th>Pos</Th>
                <Th align="right">Age</Th>
                <Th align="right">Minutes</Th>
                <Th align="right">Goals /90</Th>
                <Th align="right">xG /90</Th>
                <Th align="right">xA /90</Th>
                <Th align="right">Prog. passes /90</Th>
              </tr>
            </thead>
            <tbody>
              {squad.map((entry) => (
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
                      ? Math.floor((Date.now() - entry.player.dateOfBirth.getTime()) / (365.25 * 864e5))
                      : '-'}
                  </Td>
                  <Td align="right">{entry.minutes}</Td>
                  <Td align="right">{entry.goalsP90.toFixed(2)}</Td>
                  <Td align="right">{entry.xgP90.toFixed(2)}</Td>
                  <Td align="right">{entry.xaP90.toFixed(2)}</Td>
                  <Td align="right">{entry.progressivePassesP90.toFixed(1)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Recent matches">
        {matches.length === 0 ? (
          <Empty>No matches.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Fixture</Th>
                <Th align="right">Score</Th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => (
                <tr key={match.id} className="hover:bg-ink-50">
                  <Td>{match.kickoffAt.toISOString().slice(0, 10)}</Td>
                  <Td>
                    <Link href={`/matches/${match.id}`} className="text-brand-600 hover:underline">
                      {match.homeTeam.name} v {match.awayTeam.name}
                    </Link>
                  </Td>
                  <Td align="right">
                    {match.homeScore !== null ? `${match.homeScore}-${match.awayScore}` : '-'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
