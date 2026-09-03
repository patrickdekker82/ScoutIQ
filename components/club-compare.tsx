'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { STYLE_LABELS } from '@/analytics/team-style';
import { Card, ConfidenceBadge, DemoBadge, Empty, PercentileBar, Table, Td, Th } from '@/components/ui';
import { ComparisonRadar, SERIES_COLOURS } from '@/components/radar';
import { TrendChart } from '@/components/trend';

/**
 * Club comparison (§44).
 *
 * Radar for tactical DNA, percentiles within the competition, a metric table
 * and match-by-match trends. As with players, percentiles are only comparable
 * inside one competition season, and the page says so when they are not.
 */

const MAX_CLUBS = 5;

interface MetricSpec {
  key: string;
  label: string;
  unit: 'percent' | 'rate';
  /** null where "more" is a style choice rather than an improvement. */
  higherIsBetter: boolean | null;
}

interface Comparison {
  analyticsVersion: string;
  sharedPopulation: boolean;
  styleDimensions: string[];
  metrics: MetricSpec[];
  trendMetrics: { key: string; label: string }[];
  populationSizes: Record<string, number>;
  clubs: {
    id: string;
    name: string;
    isDemo: boolean;
    season: {
      competitionSeasonId: string;
      competitionName: string;
      seasonName: string;
      matches: number;
      confidence: string;
    } | null;
    metrics: Record<string, number | null>;
    percentiles: Record<string, number>;
    style: Record<string, number>;
    defensiveActionsPerMatch: number | null;
    crossesPerMatch: number | null;
    trend: { matchId: string; label: string; kickoffAt: string; values: Record<string, number> }[];
  }[];
}

interface Candidate {
  id: string;
  name: string;
}

const format = (value: number | null, unit: MetricSpec['unit']): string => {
  if (value === null) return '-';
  if (unit === 'percent') return `${(value <= 1 ? value * 100 : value).toFixed(1)}%`;
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
};

function ClubPicker({ onPick, disabled }: { onPick: (club: Candidate) => void; disabled: boolean }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
      }).catch(() => null);
      if (response?.ok) {
        const body = (await response.json()) as { teams: Candidate[] };
        setResults(body.teams ?? []);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="relative">
      <input
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={disabled ? `Maximum of ${MAX_CLUBS} clubs` : 'Add a club...'}
        className="w-64 rounded-md border border-ink-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 disabled:bg-ink-50"
      />

      {results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-64 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg">
          {results.map((club) => (
            <li key={club.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(club);
                  setQuery('');
                  setResults([]);
                }}
                className="w-full px-3 py-1.5 text-left text-sm text-ink-800 hover:bg-ink-50"
              >
                {club.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClubCompare({ initialIds }: { initialIds: string[] }) {
  const [ids, setIds] = useState<string[]>(initialIds.slice(0, MAX_CLUBS));
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ids.length < 2) {
      setData(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setBusy(true);
    void (async () => {
      const response = await fetch(`/api/v1/teams/compare?ids=${ids.join(',')}`, {
        signal: controller.signal,
      }).catch(() => null);

      if (controller.signal.aborted) return;
      setBusy(false);

      if (!response?.ok) {
        setError('Could not load that comparison.');
        setData(null);
        return;
      }
      setError(null);
      setData((await response.json()) as Comparison);
    })();

    return () => controller.abort();
  }, [ids]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (ids.length > 0) url.searchParams.set('ids', ids.join(','));
    else url.searchParams.delete('ids');
    window.history.replaceState(null, '', url.toString());
  }, [ids]);

  const clubs = data?.clubs ?? [];

  const radarSeries = useMemo(
    () =>
      clubs.map((club) => ({
        label: club.name,
        scores: Object.fromEntries(
          Object.entries(club.style).map(([key, value]) => [STYLE_LABELS[key as keyof typeof STYLE_LABELS] ?? key, value]),
        ),
      })),
    [clubs],
  );

  const radarCategories = useMemo(
    () =>
      (data?.styleDimensions ?? []).map(
        (key) => STYLE_LABELS[key as keyof typeof STYLE_LABELS] ?? key,
      ),
    [data],
  );

  const populationSize = clubs[0]?.season
    ? (data?.populationSizes[clubs[0].season.competitionSeasonId] ?? 0)
    : 0;

  return (
    <div className="space-y-5">
      <Card
        title="Compare clubs"
        subtitle="Two to five clubs, side by side (§44)"
        actions={
          <ClubPicker
            disabled={ids.length >= MAX_CLUBS}
            onPick={(club) =>
              setIds((current) =>
                current.includes(club.id) || current.length >= MAX_CLUBS
                  ? current
                  : [...current, club.id],
              )
            }
          />
        }
      >
        {ids.length === 0 ? (
          <Empty>Search for a club above to start a comparison.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(clubs.length > 0 ? clubs : ids.map((id) => ({ id, name: id }))).map((club, index) => (
              <span
                key={club.id}
                className="flex items-center gap-2 rounded-full border border-ink-200 py-1 pl-2.5 pr-1.5 text-sm"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                />
                {club.name}
                <button
                  type="button"
                  aria-label={`Remove ${club.name}`}
                  onClick={() => setIds((current) => current.filter((id) => id !== club.id))}
                  className="rounded-full px-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                >
                  x
                </button>
              </span>
            ))}
          </div>
        )}

        {ids.length === 1 && <p className="mt-3 text-sm text-ink-500">Add one more club to compare.</p>}
        {busy && <p className="mt-3 text-sm text-ink-500">Loading comparison...</p>}
        {error && <p className="mt-3 text-sm font-medium text-bad">{error}</p>}
      </Card>

      {data && clubs.length >= 2 && (
        <>
          {!data.sharedPopulation && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              These clubs are not all in the same competition season. Raw values are still
              comparable; percentiles rank each club inside its own competition and are not
              comparable across them.
            </p>
          )}

          <Card title="Season">
            <Table>
              <thead>
                <tr>
                  <Th>Club</Th>
                  <Th>Competition</Th>
                  <Th align="right">Matches</Th>
                  <Th>Confidence</Th>
                </tr>
              </thead>
              <tbody>
                {clubs.map((club) => (
                  <tr key={club.id}>
                    <Td>
                      <Link href={`/teams/${club.id}`} className="hover:text-brand-600">
                        {club.name}
                      </Link>
                      {club.isDemo && (
                        <span className="ml-1">
                          <DemoBadge />
                        </span>
                      )}
                    </Td>
                    <Td>
                      {club.season
                        ? `${club.season.competitionName} ${club.season.seasonName}`
                        : 'No analytics yet'}
                    </Td>
                    <Td align="right">{club.season?.matches ?? '-'}</Td>
                    <Td>
                      <ConfidenceBadge
                        confidence={club.season?.confidence ?? null}
                        matches={club.season?.matches}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title="Tactical DNA" subtitle="The 14 style dimensions, overlaid (§31)">
            {radarCategories.length < 3 ? (
              <Empty>No style profiles computed for these clubs.</Empty>
            ) : (
              <ComparisonRadar
                categories={radarCategories}
                series={radarSeries}
                size={360}
                className="mx-auto max-w-2xl"
              />
            )}
          </Card>

          <Card
            title="Metrics"
            subtitle={
              populationSize > 0
                ? `Season values, with the rank among ${populationSize} clubs in the same competition`
                : 'Season values'
            }
          >
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  {clubs.map((club) => (
                    <Th key={club.id} align="right">
                      {club.name}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((metric) => {
                  const values = clubs.map((club) => club.metrics[metric.key] ?? null);
                  const present = values.filter((value): value is number => value !== null);
                  // Emphasis follows the metric's own direction: fewer goals
                  // conceded is better, more possession is only different.
                  const best =
                    metric.higherIsBetter === null || present.length === 0
                      ? null
                      : metric.higherIsBetter
                        ? Math.max(...present)
                        : Math.min(...present);

                  return (
                    <tr key={metric.key}>
                      <Td>{metric.label}</Td>
                      {clubs.map((club, index) => {
                        const value = values[index] ?? null;
                        const percentile = club.percentiles[metric.key];
                        const isBest =
                          best !== null &&
                          value === best &&
                          present.filter((entry) => entry === best).length === 1;

                        return (
                          <Td key={club.id} align="right">
                            {value === null ? (
                              <span className="text-ink-300">-</span>
                            ) : (
                              <span className={isBest ? 'font-semibold text-ink-900' : ''}>
                                {format(value, metric.unit)}
                                {percentile !== undefined && (
                                  <span className="ml-1 text-[11px] text-ink-400">
                                    ({percentile.toFixed(0)})
                                  </span>
                                )}
                              </span>
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  );
                })}

                <tr>
                  <Td>Crosses per match</Td>
                  {clubs.map((club) => (
                    <Td key={club.id} align="right">
                      {club.crossesPerMatch?.toFixed(1) ?? <span className="text-ink-300">-</span>}
                    </Td>
                  ))}
                </tr>
                <tr>
                  <Td>Defensive actions per match</Td>
                  {clubs.map((club) => (
                    <Td key={club.id} align="right">
                      {club.defensiveActionsPerMatch?.toFixed(1) ?? (
                        <span className="text-ink-300">-</span>
                      )}
                    </Td>
                  ))}
                </tr>
              </tbody>
            </Table>
            <p className="mt-2 text-[11px] text-ink-400">
              Bracketed numbers rank the raw value within the club&apos;s own competition season,
              not its quality: on xG against and PPDA, where less is better, a low rank is the good
              end. Bold marks the better value only where a direction exists - possession,
              directness and passing volume are style choices, not scores. Crosses and defensive
              actions are averaged from the per-match metrics, which is why they carry no rank.
            </p>
          </Card>

          <Card title="Style percentiles" subtitle="Each dimension ranked within the competition">
            <Table>
              <thead>
                <tr>
                  <Th>Dimension</Th>
                  {clubs.map((club) => (
                    <Th key={club.id}>{club.name}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data.styleDimensions ?? []).map((dimension) => (
                  <tr key={dimension}>
                    <Td>{STYLE_LABELS[dimension as keyof typeof STYLE_LABELS] ?? dimension}</Td>
                    {clubs.map((club) => (
                      <Td key={club.id}>
                        {club.style[dimension] === undefined ? (
                          <span className="text-ink-300">Not computed</span>
                        ) : (
                          <PercentileBar percentile={club.style[dimension] as number} />
                        )}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title="Match by match" subtitle="Every match played, in order">
            <div className="grid gap-5 sm:grid-cols-2">
              {data.trendMetrics.map((metric) => (
                <TrendChart
                  key={metric.key}
                  title={metric.label}
                  series={clubs.map((club) => ({
                    label: club.name,
                    points: club.trend.map((entry) => ({
                      value: entry.values[metric.key] ?? 0,
                      label: entry.label,
                    })),
                  }))}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
              {clubs.map((club, index) => (
                <li key={club.id} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                  />
                  {club.name}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-400">
              Clubs that have played a different number of matches produce lines of different
              length; the x-axis is match order, not date, so the same position on two lines is not
              the same day.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
