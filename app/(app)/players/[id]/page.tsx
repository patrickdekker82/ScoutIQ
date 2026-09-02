import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ANALYTICS_VERSION } from '@/analytics/version';
import { prisma } from '@/db/client';
import { Card, ConfidenceBadge, DemoBadge, Empty, PercentileBar, Stat, Table, Td, Th } from '@/components/ui';
import { DnaRadar } from '@/components/radar';
import { PlayerHeatmap } from '@/components/player-heatmap';
import { ShotMap } from '@/components/pitch';
import { humanise } from '@/reports/blocks';
import { GenerateReportButton } from '@/components/generate-report';

export const dynamic = 'force-dynamic';

/** Player page (§42). */
export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const player = await prisma.player.findUnique({
    where: { id },
    include: {
      country: { select: { name: true } },
      memberships: {
        where: { endDate: null },
        include: { team: { select: { id: true, name: true } } },
        take: 1,
      },
    },
  });
  if (!player) notFound();

  const seasonMetric = await prisma.playerSeasonMetric.findFirst({
    where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
    include: {
      season: { include: { competition: { select: { name: true } } } },
      team: { select: { id: true, name: true } },
    },
    orderBy: { minutes: 'desc' },
  });

  const [percentiles, style, roles, similar, fits, notes, shots] = await Promise.all([
    seasonMetric
      ? prisma.$queryRaw<{ metric_key: string; value: number; percentile: number; population_size: number }[]>`
          SELECT metric_key, value, percentile, population_size
          FROM vw_player_percentiles
          WHERE player_id = ${id}
            AND competition_season_id = ${seasonMetric.competitionSeasonId}
            AND analytics_version = ${ANALYTICS_VERSION}
          ORDER BY percentile DESC
        `
      : Promise.resolve([]),
    seasonMetric
      ? prisma.playerStyleProfile.findFirst({
          where: {
            playerId: id,
            competitionSeasonId: seasonMetric.competitionSeasonId,
            analyticsVersion: ANALYTICS_VERSION,
          },
        })
      : Promise.resolve(null),
    prisma.playerRoleScore.findMany({
      where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { role: { select: { name: true, description: true } } },
      orderBy: { score: 'desc' },
      take: 6,
    }),
    prisma.playerSimilarity.findMany({
      where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { comparison: { select: { id: true, fullName: true, primaryPosition: true } } },
      orderBy: { similarity: 'desc' },
      take: 8,
    }),
    prisma.playerFitScore.findMany({
      where: { playerId: id, analyticsVersion: ANALYTICS_VERSION },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { fitScore: 'desc' },
      take: 8,
    }),
    prisma.scoutingNote.findMany({
      where: { playerId: id },
      include: { author: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.event.findMany({
      where: { playerId: id, type: 'SHOT', x: { not: null }, y: { not: null } },
      select: { id: true, x: true, y: true, minute: true, shot: true },
      take: 400,
    }),
  ]);

  const age = player.dateOfBirth
    ? Math.floor((Date.now() - player.dateOfBirth.getTime()) / (365.25 * 864e5))
    : null;

  const dna = (style?.dna as Record<string, number> | undefined) ?? null;
  const dnaInputs =
    (style?.inputs as { categories?: { category: string; inputs: unknown[] }[] } | undefined)
      ?.categories ?? [];

  const identity: [string, string | number | null][] = [
    ['Position', player.primaryPosition],
    ['Group', player.positionGroup],
    ['Age', age],
    ['Nationality', player.country?.name ?? null],
    ['Foot', player.preferredFoot],
    ['Height', player.heightCm ? `${player.heightCm} cm` : null],
    ['Club', seasonMetric?.team?.name ?? player.memberships[0]?.team.name ?? null],
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">{player.fullName}</h1>
            {player.isDemo && <DemoBadge />}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {identity
              .filter(([, value]) => value !== null && value !== '')
              .map(([label, value]) => `${label}: ${value}`)
              .join('  ·  ')}
          </p>
          {seasonMetric && (
            <p className="mt-2 flex items-center gap-2 text-sm text-ink-600">
              <span>
                {seasonMetric.season.competition.name} {seasonMetric.season.seasonName}
              </span>
              <ConfidenceBadge
                confidence={seasonMetric.confidence}
                minutes={seasonMetric.minutes}
                matches={seasonMetric.matches}
              />
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/players/compare?ids=${player.id}`}
            className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Compare
          </Link>
          <GenerateReportButton playerId={player.id} />
        </div>
      </header>

      {!seasonMetric ? (
        <Empty>
          No analytics for this player yet. Run{' '}
          <code className="rounded bg-ink-100 px-1">npm run analytics:refresh</code>.
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Minutes" value={seasonMetric.minutes} />
            <Stat label="Matches" value={seasonMetric.matches} />
            <Stat label="Goals /90" value={seasonMetric.goalsP90.toFixed(2)} />
            <Stat label="xG /90" value={seasonMetric.xgP90.toFixed(2)} />
            <Stat label="xA /90" value={seasonMetric.xaP90.toFixed(2)} />
            <Stat label="Prog. passes /90" value={seasonMetric.progressivePassesP90.toFixed(1)} />
            <Stat label="Pass acc." value={`${(seasonMetric.passAccuracy * 100).toFixed(0)}%`} />
            <Stat label="Pressures /90" value={seasonMetric.pressuresP90.toFixed(1)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card
              title="Player DNA"
              subtitle={
                style?.referencePopulation
                  ? 'Percentiles within the same competition season and position group'
                  : undefined
              }
              actions={<ConfidenceBadge confidence={style?.confidence ?? null} />}
            >
              {dna ? (
                <>
                  <DnaRadar
                    axes={Object.entries(dna).map(([category, score]) => ({
                      category,
                      score,
                      inputs: (
                        dnaInputs.find((entry) => entry.category === category)?.inputs ?? []
                      ) as { metricKey: string; percentile: number; weight: number }[],
                    }))}
                  />
                  <p className="mt-2 text-[11px] text-ink-400">
                    Hover an axis to see the metrics and weights behind the score.
                    Categories with no source data are left out rather than scored zero.
                  </p>
                </>
              ) : (
                <Empty>No DNA profile computed.</Empty>
              )}
            </Card>

            <Card
              title="Percentile ranks"
              subtitle={`Against ${percentiles[0]?.population_size ?? 0} comparable players`}
              className="lg:col-span-2"
            >
              {percentiles.length === 0 ? (
                <Empty>Not enough minutes to rank this player.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Metric</Th>
                      <Th align="right">Value</Th>
                      <Th>Percentile</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {percentiles.slice(0, 18).map((entry) => (
                      <tr key={entry.metric_key}>
                        <Td>{humanise(entry.metric_key)}</Td>
                        <Td align="right">{Number(entry.value).toFixed(2)}</Td>
                        <Td>
                          <PercentileBar percentile={Number(entry.percentile)} />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <PlayerHeatmap playerId={player.id} />

            <Card title="Shot map" subtitle={`${shots.length} shots, sized by xG`}>
              {shots.length === 0 ? (
                <Empty>No shots recorded.</Empty>
              ) : (
                <ShotMap
                  shots={shots.map((shot) => ({
                    id: shot.id,
                    x: shot.x as number,
                    y: shot.y as number,
                    xg: shot.shot?.xg ?? 0,
                    isGoal: shot.shot?.isGoal ?? false,
                    onTarget: shot.shot?.onTarget ?? false,
                    minute: shot.minute,
                    playerName: player.fullName,
                  }))}
                />
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title="Role fit" subtitle="Weighted percentile match against each role">
              {roles.length === 0 ? (
                <Empty>
                  {player.positionGroup === 'GK'
                    ? 'No goalkeeper roles are defined. Roles are data - add one and re-run analytics.'
                    : 'No role scores yet. Run npm run analytics:refresh.'}
                </Empty>
              ) : (
                <ul className="space-y-2.5">
                  {roles.map((role) => (
                    <li key={role.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-ink-800">
                          {role.role.name}
                          {role.isPrimary && (
                            <span className="ml-1.5 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                              primary
                            </span>
                          )}
                        </span>
                        <span className="tabular text-sm font-semibold text-brand-600">
                          {role.score.toFixed(1)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-200">
                        <div
                          className="h-full rounded-full bg-brand-500"
                          style={{ width: `${Math.min(100, role.score)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Similar players" subtitle="Weighted cosine similarity, same position group">
              {similar.length === 0 ? (
                <Empty>No comparisons available.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {similar.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        href={`/players/${entry.comparisonPlayerId}`}
                        className="truncate text-brand-600 hover:underline"
                      >
                        {entry.comparison.fullName}
                      </Link>
                      <span className="tabular shrink-0 text-ink-600">
                        {(entry.similarity * 100).toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Club fit"
              subtitle="Stylistic overlap - an analytical model, not objective truth"
            >
              {fits.length === 0 ? (
                <Empty>No fit scores computed.</Empty>
              ) : (
                <ul className="space-y-1.5">
                  {fits.map((fit) => (
                    <li key={fit.id} className="flex items-center justify-between gap-2 text-sm">
                      <Link
                        href={`/teams/${fit.teamId}`}
                        className="truncate text-brand-600 hover:underline"
                      >
                        {fit.team.name}
                      </Link>
                      <span className="tabular shrink-0 font-semibold text-ink-700">
                        {fit.fitScore.toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Scout notes" subtitle="Human observation, kept separate from the models">
            {notes.length === 0 ? (
              <Empty>No notes yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {notes.map((note) => (
                  <li key={note.id} className="border-l-2 border-ink-200 pl-3 text-sm">
                    <div className="text-xs text-ink-400">
                      {note.author.displayName}
                      {note.minute !== null && ` · ${note.minute}'`} ·{' '}
                      {note.createdAt.toISOString().slice(0, 10)}
                    </div>
                    <p className="text-ink-700">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
