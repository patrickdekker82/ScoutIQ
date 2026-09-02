'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, ConfidenceBadge, DemoBadge, Empty, Table, Td, Th } from '@/components/ui';

/**
 * Player search (§45).
 *
 * Filters map to indexed columns and season metrics; metric filters accept
 * operators, including a percentile operator that ranks within the player's own
 * position group and season - the population is never implicit (§26).
 */

interface Season {
  id: string;
  label: string;
}

interface Row {
  playerId: string;
  playerName: string;
  age: number | null;
  nationality: string | null;
  positionGroup: string;
  position: string;
  seasonName: string | null;
  minutes: number;
  matches: number;
  confidence: string | null;
  isDemo: boolean;
  metrics: Record<string, number>;
}

const METRIC_CHOICES = [
  { key: 'goalsP90', label: 'Goals /90' },
  { key: 'xgP90', label: 'xG /90' },
  { key: 'xaP90', label: 'xA /90' },
  { key: 'shotsP90', label: 'Shots /90' },
  { key: 'progressivePassesP90', label: 'Progressive passes /90' },
  { key: 'progressiveCarriesP90', label: 'Progressive carries /90' },
  { key: 'keyPassesP90', label: 'Key passes /90' },
  { key: 'passAccuracy', label: 'Pass accuracy' },
  { key: 'pressuresP90', label: 'Pressures /90' },
  { key: 'tacklesP90', label: 'Tackles /90' },
  { key: 'interceptionsP90', label: 'Interceptions /90' },
  { key: 'aerialDuelWinRate', label: 'Aerial duel win rate' },
  { key: 'dribblesP90', label: 'Dribbles /90' },
];

const OPERATORS = [
  { key: 'gte', label: '>=' },
  { key: 'lte', label: '<=' },
  { key: 'gt', label: '>' },
  { key: 'lt', label: '<' },
  { key: 'percentile', label: 'percentile >=' },
];

interface MetricFilter {
  metricKey: string;
  operator: string;
  value: string;
}

export function PlayerSearch({ seasons }: { seasons: Season[] }) {
  const [name, setName] = useState('');
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? '');
  const [groups, setGroups] = useState<string[]>([]);
  const [minMinutes, setMinMinutes] = useState('450');
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [foot, setFoot] = useState('');
  const [sortBy, setSortBy] = useState('minutes');
  const [filters, setFilters] = useState<MetricFilter[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const shownMetrics = useMemo(() => {
    const fromFilters = filters.map((filter) => filter.metricKey);
    const base = ['minutes', 'goalsP90', 'xgP90', 'xaP90', 'progressivePassesP90'];
    return [...new Set([...fromFilters, ...base])].slice(0, 6);
  }, [filters]);

  const search = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (name) params.set('name', name);
    if (seasonId) params.set('competitionSeasonId', seasonId);
    if (groups.length) params.set('positionGroups', groups.join(','));
    if (minMinutes) params.set('minMinutes', minMinutes);
    if (minAge) params.set('minAge', minAge);
    if (maxAge) params.set('maxAge', maxAge);
    if (foot) params.set('preferredFoot', foot);
    params.set('sortBy', sortBy);
    params.set('take', '100');

    for (const filter of filters) {
      if (filter.value === '') continue;
      params.append('metric', `${filter.metricKey}:${filter.operator}:${filter.value}`);
    }

    const response = await fetch(`/api/v1/players?${params.toString()}`);
    if (response.ok) {
      const body = (await response.json()) as { total: number; items: Row[] };
      setRows(body.items);
      setTotal(body.total);
    }
    setLoading(false);
  }, [name, seasonId, groups, minMinutes, minAge, maxAge, foot, sortBy, filters]);

  useEffect(() => {
    void search();
    // Intentionally only on mount: later searches are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const field = 'rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

  return (
    <div className="space-y-5">
      <Card
        title="Player search"
        subtitle="Filters combine identity, playing time and metric thresholds"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Any player"
                className={`mt-1 w-full ${field}`}
              />
            </label>

            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Season
              <select
                value={seasonId}
                onChange={(event) => setSeasonId(event.target.value)}
                className={`mt-1 w-full ${field}`}
              >
                <option value="">All seasons</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Minimum minutes
              <input
                type="number"
                value={minMinutes}
                onChange={(event) => setMinMinutes(event.target.value)}
                className={`mt-1 w-full ${field}`}
              />
            </label>

            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Sort by
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className={`mt-1 w-full ${field}`}
              >
                <option value="minutes">Minutes</option>
                {METRIC_CHOICES.map((metric) => (
                  <option key={metric.key} value={metric.key}>
                    {metric.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Position
              <div className="mt-1 flex gap-1">
                {['GK', 'DF', 'MF', 'FW'].map((group) => (
                  <button
                    key={group}
                    type="button"
                    onClick={() =>
                      setGroups((current) =>
                        current.includes(group)
                          ? current.filter((entry) => entry !== group)
                          : [...current, group],
                      )
                    }
                    className={`flex-1 rounded-md border px-2 py-1.5 text-sm font-medium transition ${
                      groups.includes(group)
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-ink-300 text-ink-600 hover:bg-ink-50'
                    }`}
                  >
                    {group}
                  </button>
                ))}
              </div>
            </div>

            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Age from
              <input
                type="number"
                value={minAge}
                onChange={(event) => setMinAge(event.target.value)}
                className={`mt-1 w-full ${field}`}
              />
            </label>

            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Age to
              <input
                type="number"
                value={maxAge}
                onChange={(event) => setMaxAge(event.target.value)}
                className={`mt-1 w-full ${field}`}
              />
            </label>

            <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Foot
              <select
                value={foot}
                onChange={(event) => setFoot(event.target.value)}
                className={`mt-1 w-full ${field}`}
              >
                <option value="">Any</option>
                <option value="RIGHT">Right</option>
                <option value="LEFT">Left</option>
                <option value="BOTH">Both</option>
              </select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Metric filters
              </span>
              <button
                type="button"
                onClick={() =>
                  setFilters((current) => [
                    ...current,
                    { metricKey: 'progressivePassesP90', operator: 'gte', value: '' },
                  ])
                }
                className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-600 hover:bg-ink-50"
              >
                Add filter
              </button>
            </div>

            {filters.map((filter, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={filter.metricKey}
                  onChange={(event) =>
                    setFilters((current) =>
                      current.map((entry, position) =>
                        position === index ? { ...entry, metricKey: event.target.value } : entry,
                      ),
                    )
                  }
                  className={field}
                >
                  {METRIC_CHOICES.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>

                <select
                  value={filter.operator}
                  onChange={(event) =>
                    setFilters((current) =>
                      current.map((entry, position) =>
                        position === index ? { ...entry, operator: event.target.value } : entry,
                      ),
                    )
                  }
                  className={field}
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator.key} value={operator.key}>
                      {operator.label}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  step="0.01"
                  value={filter.value}
                  placeholder={filter.operator === 'percentile' ? '75' : '5'}
                  onChange={(event) =>
                    setFilters((current) =>
                      current.map((entry, position) =>
                        position === index ? { ...entry, value: event.target.value } : entry,
                      ),
                    )
                  }
                  className={`w-28 ${field}`}
                />

                <button
                  type="button"
                  onClick={() =>
                    setFilters((current) => current.filter((_, position) => position !== index))
                  }
                  className="rounded-md px-2 py-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-bad"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </Card>

      <Card title={`Results`} subtitle={`${total} player seasons match`}>
        {rows.length === 0 ? (
          <Empty>No players match these filters.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Player</Th>
                <Th>Pos</Th>
                <Th align="right">Age</Th>
                <Th>Season</Th>
                {shownMetrics.map((metric) => (
                  <Th key={metric} align="right">
                    {METRIC_CHOICES.find((choice) => choice.key === metric)?.label ?? metric}
                  </Th>
                ))}
                <Th>Data</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.playerId}-${row.seasonName}`} className="hover:bg-ink-50">
                  <Td>
                    <Link
                      href={`/players/${row.playerId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {row.playerName}
                    </Link>
                    {row.isDemo && (
                      <span className="ml-2">
                        <DemoBadge />
                      </span>
                    )}
                  </Td>
                  <Td>{row.position}</Td>
                  <Td align="right">{row.age ?? '-'}</Td>
                  <Td>{row.seasonName ?? '-'}</Td>
                  {shownMetrics.map((metric) => (
                    <Td key={metric} align="right">
                      {metric === 'minutes'
                        ? row.minutes
                        : (row.metrics[metric]?.toFixed(2) ?? '-')}
                    </Td>
                  ))}
                  <Td>
                    <ConfidenceBadge
                      confidence={row.confidence}
                      minutes={row.minutes}
                      matches={row.matches}
                    />
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
