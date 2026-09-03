'use client';

import { useEffect, useState } from 'react';
import { Card, Empty } from '@/components/ui';
import { PassingNetwork } from '@/components/pitch';

/**
 * Passing network panel (§38).
 *
 * Filters are the four the spec names: full match, first half, second half and
 * possession only. Every picture states the sample it came from, because a
 * network drawn from forty passes looks authoritative and means very little.
 */

type Period = 'full' | 'first' | 'second';

interface NetworkResponse {
  teamName: string;
  totalPasses: number;
  completedPasses: number;
  linkedPasses: number;
  minPasses: number;
  nodes: {
    playerId: string;
    name: string;
    x: number;
    y: number;
    passes: number;
    received: number;
    firstMinute: number;
    lastMinute: number;
  }[];
  edges: { from: string; to: string; passes: number }[];
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'full', label: 'Full match' },
  { key: 'first', label: '1H' },
  { key: 'second', label: '2H' },
];

export function PassingNetworkPanel({
  matchId,
  teams,
}: {
  matchId: string;
  teams: { id: string; name: string }[];
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '');
  const [period, setPeriod] = useState<Period>('full');
  const [possessionOnly, setPossessionOnly] = useState(false);
  const [minPasses, setMinPasses] = useState(2);
  const [data, setData] = useState<NetworkResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!teamId) return;
    const controller = new AbortController();
    setBusy(true);

    void (async () => {
      const params = new URLSearchParams({
        matchId,
        teamId,
        period,
        possessionOnly: String(possessionOnly),
        minPasses: String(minPasses),
      });
      const response = await fetch(`/api/v1/matches/network?${params.toString()}`, {
        signal: controller.signal,
      }).catch(() => null);

      if (controller.signal.aborted) return;
      setBusy(false);
      setData(response?.ok ? ((await response.json()) as NetworkResponse) : null);
    })();

    return () => controller.abort();
  }, [matchId, teamId, period, possessionOnly, minPasses]);

  const buttonClass = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active ? 'bg-brand-600 text-white' : 'border border-ink-300 text-ink-700 hover:bg-ink-100'
    }`;

  return (
    <Card
      title="Passing network"
      subtitle="Nodes are average pass origins; edge thickness is pass frequency (§38)"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setTeamId(team.id)}
              className={buttonClass(team.id === teamId)}
            >
              {team.name}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {PERIODS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setPeriod(entry.key)}
            className={buttonClass(entry.key === period)}
          >
            {entry.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setPossessionOnly((value) => !value)}
          title="Open-play passes in this team's own possession - excludes corners, free kicks, throw-ins, goal kicks and kick-offs"
          className={buttonClass(possessionOnly)}
        >
          Possession only
        </button>

        <label className="ml-auto flex items-center gap-2 text-xs text-ink-500">
          Minimum passes per link
          <input
            type="number"
            min={1}
            max={20}
            value={minPasses}
            onChange={(event) => setMinPasses(Math.max(1, Number(event.target.value) || 1))}
            className="w-16 rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
          />
        </label>
      </div>

      {busy && !data && <p className="text-sm text-ink-500">Loading network...</p>}

      {data && data.nodes.length === 0 && (
        <Empty>
          No located passes for this team under these filters. Passing networks need pass
          coordinates and recipients, which not every provider supplies.
        </Empty>
      )}

      {data && data.nodes.length > 0 && (
        <>
          <PassingNetwork nodes={data.nodes} edges={data.edges} />

          <p className="mt-2 text-[11px] text-ink-400">
            {data.totalPasses} passes, {data.completedPasses} completed,{' '}
            {data.linkedPasses} with a named recipient. Links below {data.minPasses} passes are
            hidden.{' '}
            {possessionOnly &&
              'Set pieces and passes during the opponent\u2019s possession are excluded. '}
            A node is a centroid over the whole selected window, not a position in a formation - a
            substitute&apos;s node rests on far fewer passes than a starter&apos;s.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200">
                  <th className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Player
                  </th>
                  <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Passes
                  </th>
                  <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Received
                  </th>
                  <th className="px-2 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                    Minutes on the ball
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.nodes.map((node) => (
                  <tr key={node.playerId}>
                    <td className="px-2 py-1.5 text-ink-800">{node.name}</td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-700">{node.passes}</td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-700">{node.received}</td>
                    <td className="tabular px-2 py-1.5 text-right text-ink-500">
                      {node.firstMinute}&apos;-{node.lastMinute}&apos;
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.edges.length > 0 && (
            <p className="mt-2 text-[11px] text-ink-400">
              Strongest link:{' '}
              {data.nodes.find((node) => node.playerId === data.edges[0]?.from)?.name} to{' '}
              {data.nodes.find((node) => node.playerId === data.edges[0]?.to)?.name} (
              {data.edges[0]?.passes} passes).
            </p>
          )}
        </>
      )}
    </Card>
  );
}
