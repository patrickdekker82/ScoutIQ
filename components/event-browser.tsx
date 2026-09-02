'use client';

import { useEffect, useState } from 'react';
import { Card, Empty, Table, Td, Th } from '@/components/ui';

/**
 * Event browser (§89).
 *
 * Paginated by design: a match holds thousands of events and §59 forbids
 * shipping them all. Each row carries its provenance so any number can be
 * traced back to the provider record that produced it (§11).
 */

interface EventRow {
  id: string;
  minute: number;
  second: number;
  type: string;
  subType: string | null;
  player: { id: string; fullName: string } | null;
  team: { id: string; name: string } | null;
  x: number | null;
  y: number | null;
  outcome: string | null;
  provenance: { provider: string | null; providerEventId: string | null };
}

const TYPES = [
  'PASS',
  'SHOT',
  'CARRY',
  'DRIBBLE',
  'DUEL',
  'TACKLE',
  'INTERCEPTION',
  'PRESSURE',
  'RECOVERY',
  'CLEARANCE',
  'FOUL',
];

export function EventBrowser({ matchId }: { matchId: string }) {
  const [type, setType] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [total, setTotal] = useState(0);
  const take = 100;

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      const params = new URLSearchParams({ take: String(take), skip: String(page * take) });
      if (type) params.set('type', type);

      const response = await fetch(
        `/api/v1/matches/${matchId}/events?${params.toString()}`,
        { signal: controller.signal },
      ).catch(() => null);

      if (response?.ok) {
        const body = (await response.json()) as { total: number; items: EventRow[] };
        setRows(body.items);
        setTotal(body.total);
      }
    }

    void load();
    return () => controller.abort();
  }, [matchId, type, page]);

  const pages = Math.ceil(total / take);

  return (
    <Card
      title="Event browser"
      subtitle={`${total.toLocaleString()} events`}
      actions={
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(0);
          }}
          className="rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
        >
          <option value="">All types</option>
          {TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      }
    >
      {rows.length === 0 ? (
        <Empty>No events match this filter.</Empty>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th align="right">Time</Th>
                <Th>Type</Th>
                <Th>Player</Th>
                <Th>Team</Th>
                <Th align="right">x</Th>
                <Th align="right">y</Th>
                <Th>Outcome</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-ink-50">
                  <Td align="right">
                    {row.minute}:{String(row.second).padStart(2, '0')}
                  </Td>
                  <Td>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-700">
                      {row.type}
                    </span>
                  </Td>
                  <Td>{row.player?.fullName ?? '-'}</Td>
                  <Td>{row.team?.name ?? '-'}</Td>
                  <Td align="right">{row.x?.toFixed(1) ?? '-'}</Td>
                  <Td align="right">{row.y?.toFixed(1) ?? '-'}</Td>
                  <Td>{row.outcome ?? '-'}</Td>
                  <Td>
                    <span
                      className="text-[11px] text-ink-400"
                      title={`Provider event id: ${row.provenance.providerEventId ?? 'unknown'}`}
                    >
                      {row.provenance.provider ?? '-'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
            <span>
              Page {page + 1} of {pages || 1}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                className="rounded-md border border-ink-300 px-2 py-1 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page + 1 >= pages}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md border border-ink-300 px-2 py-1 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
