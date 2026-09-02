'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, ConfidenceBadge, DemoBadge, Empty, Table, Td, Th } from '@/components/ui';
import { ComparisonRadar, SERIES_COLOURS } from '@/components/radar';
import { PlayerHeatmap } from '@/components/player-heatmap';

/**
 * Player comparison (§43).
 *
 * Two to five players side by side: profile, DNA, percentiles, metrics, role
 * scores, heatmaps, club fit, strengths and weaknesses. Percentiles only mean
 * anything inside one population, so the page warns when the players are ranked
 * in different ones instead of quietly comparing incomparables (§26).
 */

const MAX_PLAYERS = 5;

interface Comparison {
  analyticsVersion: string;
  sharedPopulation: boolean;
  dnaCategories: string[];
  metricKeys: string[];
  players: {
    id: string;
    fullName: string;
    isDemo: boolean;
    primaryPosition: string | null;
    positionGroup: string | null;
    age: number | null;
    nationality: string | null;
    preferredFoot: string | null;
    heightCm: number | null;
    club: string | null;
    season: {
      competitionSeasonId: string;
      competitionName: string;
      seasonName: string;
      positionGroup: string;
      minutes: number;
      matches: number;
      confidence: string;
    } | null;
    metrics: Record<string, number>;
    percentiles: Record<string, { percentile: number; populationSize: number }>;
    dna: Record<string, number>;
    roles: { name: string; score: number }[];
    fits: { teamId: string; teamName: string; fitScore: number }[];
    strengths: { metricKey: string; percentile: number }[];
    weaknesses: { metricKey: string; percentile: number }[];
  }[];
}

interface Candidate {
  id: string;
  fullName: string;
  primaryPosition: string | null;
  isDemo: boolean;
}

/** `progressivePassesP90` -> `Progressive passes /90`. */
export function metricLabel(key: string): string {
  const spaced = key
    .replace(/P90$/, ' /90')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const format = (key: string, value: number): string => {
  if (key.endsWith('Rate') || key === 'passAccuracy') return `${(value * 100).toFixed(0)}%`;
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
};

function PlayerPicker({
  onPick,
  disabled,
}: {
  onPick: (candidate: Candidate) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const box = useRef<HTMLDivElement>(null);

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
        const body = (await response.json()) as { players: Candidate[] };
        setResults(body.players ?? []);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div ref={box} className="relative">
      <input
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={disabled ? `Maximum of ${MAX_PLAYERS} players` : 'Add a player...'}
        className="w-72 rounded-md border border-ink-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 disabled:bg-ink-50"
      />

      {results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-72 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg">
          {results.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(candidate);
                  setQuery('');
                  setResults([]);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50"
              >
                <span className="text-ink-800">{candidate.fullName}</span>
                <span className="text-xs text-ink-400">{candidate.primaryPosition}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PlayerCompare({ initialIds }: { initialIds: string[] }) {
  const [ids, setIds] = useState<string[]>(initialIds.slice(0, MAX_PLAYERS));
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
      const response = await fetch(`/api/v1/players/compare?ids=${ids.join(',')}`, {
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

  // Keep the URL shareable: a comparison is a link a scout sends to a colleague.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (ids.length > 0) url.searchParams.set('ids', ids.join(','));
    else url.searchParams.delete('ids');
    window.history.replaceState(null, '', url.toString());
  }, [ids]);

  const players = data?.players ?? [];

  const radarSeries = useMemo(
    () => players.map((player) => ({ label: player.fullName, scores: player.dna })),
    [players],
  );

  const percentileKeys = useMemo(() => {
    if (!data) return [];
    return data.metricKeys.filter((key) =>
      players.some((player) => player.percentiles[key] !== undefined),
    );
  }, [data, players]);

  return (
    <div className="space-y-5">
      <Card
        title="Compare players"
        subtitle={`Two to five players, side by side (§43)`}
        actions={
          <PlayerPicker
            disabled={ids.length >= MAX_PLAYERS}
            onPick={(candidate) =>
              setIds((current) =>
                current.includes(candidate.id) || current.length >= MAX_PLAYERS
                  ? current
                  : [...current, candidate.id],
              )
            }
          />
        }
      >
        {ids.length === 0 ? (
          <Empty>Search for a player above to start a comparison.</Empty>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(players.length > 0 ? players : ids.map((id) => ({ id, fullName: id }))).map(
              (player, index) => (
                <span
                  key={player.id}
                  className="flex items-center gap-2 rounded-full border border-ink-200 py-1 pl-2.5 pr-1.5 text-sm"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: SERIES_COLOURS[index % SERIES_COLOURS.length] }}
                  />
                  {player.fullName}
                  <button
                    type="button"
                    aria-label={`Remove ${player.fullName}`}
                    onClick={() => setIds((current) => current.filter((id) => id !== player.id))}
                    className="rounded-full px-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                  >
                    x
                  </button>
                </span>
              ),
            )}
          </div>
        )}

        {ids.length === 1 && (
          <p className="mt-3 text-sm text-ink-500">Add one more player to compare.</p>
        )}
        {busy && <p className="mt-3 text-sm text-ink-500">Loading comparison...</p>}
        {error && <p className="mt-3 text-sm font-medium text-bad">{error}</p>}
      </Card>

      {data && players.length >= 2 && (
        <>
          {!data.sharedPopulation && (
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              These players are ranked in different populations (competition season and position
              group). Raw per-90 values are still comparable; percentiles are not directly
              comparable across populations.
            </p>
          )}

          <Card title="Profile">
            <Table>
              <thead>
                <tr>
                  <Th>Attribute</Th>
                  {players.map((player) => (
                    <Th key={player.id}>
                      <Link href={`/players/${player.id}`} className="hover:text-brand-600">
                        {player.fullName}
                      </Link>
                      {player.isDemo && (
                        <span className="ml-1">
                          <DemoBadge />
                        </span>
                      )}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Position', (p: Comparison['players'][number]) => p.primaryPosition],
                    ['Group', (p: Comparison['players'][number]) => p.positionGroup],
                    ['Age', (p: Comparison['players'][number]) => p.age],
                    ['Nationality', (p: Comparison['players'][number]) => p.nationality],
                    ['Foot', (p: Comparison['players'][number]) => p.preferredFoot],
                    [
                      'Height',
                      (p: Comparison['players'][number]) =>
                        p.heightCm ? `${p.heightCm} cm` : null,
                    ],
                    ['Club', (p: Comparison['players'][number]) => p.club],
                    [
                      'Season',
                      (p: Comparison['players'][number]) =>
                        p.season ? `${p.season.competitionName} ${p.season.seasonName}` : null,
                    ],
                    [
                      'Minutes',
                      (p: Comparison['players'][number]) => p.season?.minutes ?? null,
                    ],
                    [
                      'Matches',
                      (p: Comparison['players'][number]) => p.season?.matches ?? null,
                    ],
                  ] as [string, (p: Comparison['players'][number]) => unknown][]
                ).map(([label, read]) => (
                  <tr key={label}>
                    <Td>{label}</Td>
                    {players.map((player) => {
                      const value = read(player);
                      return (
                        <Td key={player.id}>
                          {value === null || value === undefined || value === '' ? (
                            <span className="text-ink-300">-</span>
                          ) : (
                            String(value)
                          )}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <Td>Confidence</Td>
                  {players.map((player) => (
                    <Td key={player.id}>
                      <ConfidenceBadge
                        confidence={player.season?.confidence ?? null}
                        minutes={player.season?.minutes}
                        matches={player.season?.matches}
                      />
                    </Td>
                  ))}
                </tr>
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="DNA" subtitle="Overlaid category scores (§27)">
              {data.dnaCategories.length < 3 ? (
                <Empty>No DNA profiles computed for these players.</Empty>
              ) : (
                <ComparisonRadar categories={data.dnaCategories} series={radarSeries} />
              )}
            </Card>

            <Card title="Role scores" subtitle="Best-fitting system roles (§30)">
              <Table>
                <thead>
                  <tr>
                    <Th>Player</Th>
                    <Th>Top roles</Th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.id}>
                      <Td>{player.fullName}</Td>
                      <Td>
                        {player.roles.length === 0 ? (
                          <span className="text-ink-300">Not scored</span>
                        ) : (
                          player.roles
                            .map((role) => `${role.name} ${role.score.toFixed(0)}`)
                            .join('  ·  ')
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </div>

          <Card
            title="Metrics"
            subtitle="Per-90 rates, with the percentile inside each player's own population"
          >
            {data.metricKeys.length === 0 ? (
              <Empty>No season metrics for these players.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Metric</Th>
                    {players.map((player) => (
                      <Th key={player.id} align="right">
                        {player.fullName}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.metricKeys.map((key) => {
                    const values = players.map((player) => player.metrics[key] ?? null);
                    // Highest, not "best": more clearances is not automatically
                    // better football, so the emphasis is descriptive only.
                    const highest = Math.max(...values.map((value) => value ?? -Infinity));
                    return (
                      <tr key={key}>
                        <Td>{metricLabel(key)}</Td>
                        {players.map((player, index) => {
                          const value = values[index] ?? null;
                          const percentile = player.percentiles[key]?.percentile;
                          return (
                            <Td key={player.id} align="right">
                              {value === null ? (
                                <span className="text-ink-300">-</span>
                              ) : (
                                <span
                                  className={
                                    value === highest &&
                                    values.filter((v) => v === highest).length === 1
                                      ? 'font-semibold text-ink-900'
                                      : ''
                                  }
                                >
                                  {format(key, value)}
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
                </tbody>
              </Table>
            )}
            {percentileKeys.length > 0 && (
              <p className="mt-2 text-[11px] text-ink-400">
                Bracketed numbers are percentile ranks within the player&apos;s own competition
                season and position group, minimum 450 minutes. Bold marks the highest value in a
                row, which is not the same as the best - context decides that.
              </p>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Strengths" subtitle="Metrics at or above the 70th percentile">
              <ul className="space-y-2 text-sm">
                {players.map((player) => (
                  <li key={player.id}>
                    <span className="font-medium text-ink-800">{player.fullName}</span>
                    <span className="ml-2 text-ink-600">
                      {player.strengths.length === 0
                        ? 'None at this sample size.'
                        : player.strengths
                            .map(
                              (entry) =>
                                `${metricLabel(entry.metricKey)} (${entry.percentile.toFixed(0)})`,
                            )
                            .join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Weaknesses" subtitle="Metrics at or below the 30th percentile">
              <ul className="space-y-2 text-sm">
                {players.map((player) => (
                  <li key={player.id}>
                    <span className="font-medium text-ink-800">{player.fullName}</span>
                    <span className="ml-2 text-ink-600">
                      {player.weaknesses.length === 0
                        ? 'None at this sample size.'
                        : player.weaknesses
                            .map(
                              (entry) =>
                                `${metricLabel(entry.metricKey)} (${entry.percentile.toFixed(0)})`,
                            )
                            .join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Club fit" subtitle="Best stylistic matches (§32)">
            <Table>
              <thead>
                <tr>
                  <Th>Player</Th>
                  <Th>Best fits</Th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr key={player.id}>
                    <Td>{player.fullName}</Td>
                    <Td>
                      {player.fits.length === 0 ? (
                        <span className="text-ink-300">Not scored</span>
                      ) : (
                        player.fits.map((fit, index) => (
                          <span key={fit.teamId}>
                            {index > 0 && '  ·  '}
                            <Link href={`/teams/${fit.teamId}`} className="hover:text-brand-600">
                              {fit.teamName}
                            </Link>{' '}
                            {fit.fitScore.toFixed(0)}
                          </span>
                        ))
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card title="Heatmaps" subtitle="Touch density on the canonical 105 x 68 m pitch (§35)">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {players.map((player) => (
                <div key={player.id}>
                  <div className="mb-1 text-xs font-medium text-ink-700">{player.fullName}</div>
                  <PlayerHeatmap playerId={player.id} />
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
