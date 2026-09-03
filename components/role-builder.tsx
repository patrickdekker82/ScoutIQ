'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, ConfidenceBadge, Empty, Table, Td, Th } from '@/components/ui';

/**
 * Custom role builder (§29, §84).
 *
 * A role is a set of weighted metric requirements. You can try one out before
 * saving it - the matches update from the live definition - so the weights can
 * be tuned against the players they actually pick out rather than in the
 * abstract.
 */

const GROUPS = ['GK', 'DF', 'MF', 'FW'] as const;

export interface MetricOption {
  key: string;
  label: string;
}

export interface ExistingRole {
  id: string;
  key: string;
  name: string;
  positionGroup: string;
  description: string | null;
  minMinutes: number;
  isSystem: boolean;
  scored: number;
  requirements: { metricKey: string; weight: number; direction: string }[];
}

interface Requirement {
  metricKey: string;
  weight: number;
  direction: 'HIGHER_BETTER' | 'LOWER_BETTER';
}

interface Match {
  playerId: string;
  playerName: string;
  position: string | null;
  age: number | null;
  club: string | null;
  season: string;
  minutes: number;
  confidence: string;
  score: number;
  coverage: number;
  breakdown: { metricKey: string; percentile: number; weight: number }[];
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

const input =
  'mt-1 block rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

export function RoleBuilder({
  metrics,
  roles,
  seasons,
  canEdit,
}: {
  metrics: MetricOption[];
  roles: ExistingRole[];
  seasons: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [positionGroup, setPositionGroup] = useState<(typeof GROUPS)[number]>('MF');
  const [description, setDescription] = useState('');
  const [minMinutes, setMinMinutes] = useState(450);
  const [requirements, setRequirements] = useState<Requirement[]>([
    { metricKey: 'progressivePassesP90', weight: 1, direction: 'HIGHER_BETTER' },
  ]);

  const [competitionSeasonId, setSeason] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [minHeightCm, setMinHeight] = useState('');
  const [preferredFoot, setFoot] = useState('');

  const [result, setResult] = useState<{
    population: number;
    candidates: number;
    matches: Match[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const definition = () => ({
    positionGroup,
    minMinutes,
    requirements,
    ...(competitionSeasonId ? { competitionSeasonId } : {}),
    ...(maxAge ? { maxAge: Number(maxAge) } : {}),
    ...(minHeightCm ? { minHeightCm: Number(minHeightCm) } : {}),
    ...(preferredFoot ? { preferredFoot } : {}),
  });

  const preview = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await fetch('/api/v1/roles/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(definition()),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setResult(
      (await response.json()) as { population: number; candidates: number; matches: Match[] },
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const response = await fetch('/api/v1/roles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        positionGroup,
        minMinutes,
        requirements,
        ...(description ? { description } : {}),
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setName('');
    setDescription('');
    setNotice(
      'Role saved. Run an analytics refresh to score every player against it and have it appear on player pages.',
    );
    router.refresh();
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/v1/roles/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (!response.ok) setError(await readError(response));
    else router.refresh();
  };

  return (
    <div className="space-y-5">
      <Card
        title="Role builder"
        subtitle="A role is data, not code - define one and the engine scores every player against it (§29, §84)"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Role name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ball-winning midfielder"
              className={`${input} w-56`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Position group
            <select
              value={positionGroup}
              onChange={(event) => setPositionGroup(event.target.value as (typeof GROUPS)[number])}
              className={`${input} w-28`}
            >
              {GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Minimum minutes
            <input
              type="number"
              min={0}
              max={5000}
              value={minMinutes}
              onChange={(event) => setMinMinutes(Number(event.target.value) || 0)}
              className={`${input} w-28`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`${input} w-72`}
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Metrics and weights
          </div>

          <ul className="mt-2 space-y-2">
            {requirements.map((requirement, index) => (
              <li key={index} className="flex flex-wrap items-center gap-2">
                <select
                  value={requirement.metricKey}
                  onChange={(event) =>
                    setRequirements((current) =>
                      current.map((entry, position) =>
                        position === index ? { ...entry, metricKey: event.target.value } : entry,
                      ),
                    )
                  }
                  className="rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                >
                  {metrics.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}
                    </option>
                  ))}
                </select>

                <select
                  value={requirement.direction}
                  onChange={(event) =>
                    setRequirements((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? { ...entry, direction: event.target.value as Requirement['direction'] }
                          : entry,
                      ),
                    )
                  }
                  className="rounded-md border border-ink-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                >
                  <option value="HIGHER_BETTER">more is better</option>
                  <option value="LOWER_BETTER">less is better</option>
                </select>

                <label className="flex items-center gap-1.5 text-xs text-ink-500">
                  weight
                  <input
                    type="number"
                    min={0.05}
                    max={10}
                    step={0.05}
                    value={requirement.weight}
                    onChange={(event) =>
                      setRequirements((current) =>
                        current.map((entry, position) =>
                          position === index
                            ? { ...entry, weight: Number(event.target.value) || 0.05 }
                            : entry,
                        ),
                      )
                    }
                    className="w-20 rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                  />
                </label>

                <button
                  type="button"
                  disabled={requirements.length === 1}
                  onClick={() =>
                    setRequirements((current) => current.filter((_, position) => position !== index))
                  }
                  className="text-xs font-medium text-ink-400 hover:text-bad disabled:opacity-40"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled={requirements.length >= 15}
            onClick={() =>
              setRequirements((current) => [
                ...current,
                {
                  metricKey: metrics[0]?.key ?? 'goalsP90',
                  weight: 1,
                  direction: 'HIGHER_BETTER',
                },
              ])
            }
            className="mt-2 rounded-md border border-ink-300 px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
          >
            Add a metric
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-ink-100 pt-3">
          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Competition season
            <select
              value={competitionSeasonId}
              onChange={(event) => setSeason(event.target.value)}
              className={`${input} w-64`}
            >
              <option value="">Every season</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Max age
            <input
              type="number"
              min={14}
              max={50}
              value={maxAge}
              onChange={(event) => setMaxAge(event.target.value)}
              className={`${input} w-24`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Min height (cm)
            <input
              type="number"
              min={120}
              max={230}
              value={minHeightCm}
              onChange={(event) => setMinHeight(event.target.value)}
              className={`${input} w-28`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Preferred foot
            <select
              value={preferredFoot}
              onChange={(event) => setFoot(event.target.value)}
              className={`${input} w-28`}
            >
              <option value="">Any</option>
              <option value="LEFT">Left</option>
              <option value="RIGHT">Right</option>
              <option value="BOTH">Both</option>
            </select>
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void preview()}
            className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
          >
            {busy ? 'Matching...' : 'Show matching players'}
          </button>

          {canEdit && (
            <button
              type="button"
              disabled={busy || name.trim().length < 2}
              onClick={() => void save()}
              className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              Save role
            </button>
          )}
        </div>

        <p className="mt-2 text-xs text-ink-500">
          Age, height, foot and season narrow who is listed. They do not change the percentile
          population: every player is still ranked against their whole competition season and
          position group, so a score means the same thing whatever filters are on.
        </p>
        {error && <p className="mt-2 text-xs font-medium text-bad">{error}</p>}
        {notice && <p className="mt-2 text-xs font-medium text-good">{notice}</p>}
      </Card>

      {result && (
        <Card
          title="Matching players"
          subtitle={`${result.matches.length} shown of ${result.candidates} who meet the filters, ranked against ${result.population} in the competition`}
        >
          {result.matches.length === 0 ? (
            <Empty>No player meets those filters.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Player</Th>
                  <Th>Pos</Th>
                  <Th align="right">Age</Th>
                  <Th>Club</Th>
                  <Th align="right">Minutes</Th>
                  <Th align="right">Score</Th>
                  <Th>Data</Th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((match) => (
                  <tr key={match.playerId} className="hover:bg-ink-50">
                    <Td>
                      <Link
                        href={`/players/${match.playerId}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {match.playerName}
                      </Link>
                    </Td>
                    <Td>{match.position ?? '-'}</Td>
                    <Td align="right">{match.age ?? '-'}</Td>
                    <Td>{match.club ?? '-'}</Td>
                    <Td align="right">{match.minutes}</Td>
                    <Td align="right">
                      <span
                        title={match.breakdown
                          .map(
                            (entry) =>
                              `${entry.metricKey}: ${entry.percentile.toFixed(0)}th pct (weight ${entry.weight})`,
                          )
                          .join('\n')}
                        className="font-semibold text-ink-900"
                      >
                        {match.score.toFixed(0)}
                      </span>
                      {match.coverage < 1 && (
                        <span className="ml-1 text-[11px] text-warn">
                          {(match.coverage * 100).toFixed(0)}% data
                        </span>
                      )}
                    </Td>
                    <Td>
                      <ConfidenceBadge confidence={match.confidence} minutes={match.minutes} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-[11px] text-ink-400">
            Hover a score to see the metrics, percentiles and weights behind it. Where a player is
            missing a metric the remaining weights are renormalised, and the coverage is shown.
          </p>
        </Card>
      )}

      <Card title="Existing roles" subtitle={`${roles.length} defined`}>
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Group</Th>
              <Th>Metrics</Th>
              <Th align="right">Min minutes</Th>
              <Th align="right">Players scored</Th>
              <Th align="right">Origin</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <Td>
                  <span className="font-medium text-ink-900">{role.name}</span>
                  {role.description && (
                    <div className="text-xs text-ink-500">{role.description}</div>
                  )}
                </Td>
                <Td>{role.positionGroup}</Td>
                <Td>
                  <span className="text-xs text-ink-600">
                    {role.requirements
                      .map(
                        (requirement) =>
                          `${requirement.metricKey}${requirement.direction === 'LOWER_BETTER' ? ' (low)' : ''} x${requirement.weight}`,
                      )
                      .join(', ')}
                  </span>
                </Td>
                <Td align="right">{role.minMinutes}</Td>
                <Td align="right">{role.scored}</Td>
                <Td align="right">
                  {role.isSystem ? (
                    <span className="text-xs text-ink-400">system</span>
                  ) : canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(role.id)}
                      className="text-xs font-medium text-ink-400 hover:text-bad disabled:opacity-60"
                    >
                      Delete
                    </button>
                  ) : (
                    <span className="text-xs text-ink-400">custom</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
