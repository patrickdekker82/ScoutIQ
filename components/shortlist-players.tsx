'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { ConfidenceBadge, Empty } from '@/components/ui';

/**
 * Shortlist management (§47).
 *
 * A shortlist is a working document, so status, priority, scout rating and
 * notes are all editable in place. Every change goes straight to the server -
 * there is no draft state to lose.
 */

export const STATUSES = [
  'NEW',
  'WATCHING',
  'SCOUTED',
  'INTERESTED',
  'PRIORITY',
  'REJECTED',
  'SIGNED',
] as const;

export type ShortlistStatus = (typeof STATUSES)[number];

const STATUS_TONE: Record<string, string> = {
  NEW: 'bg-ink-100 text-ink-600',
  WATCHING: 'bg-brand-50 text-brand-700',
  SCOUTED: 'bg-brand-50 text-brand-700',
  INTERESTED: 'bg-good/10 text-good',
  PRIORITY: 'bg-good/15 text-good',
  REJECTED: 'bg-bad/10 text-bad',
  SIGNED: 'bg-good/20 text-good',
};

export interface ShortlistEntry {
  id: string;
  playerId: string;
  playerName: string;
  position: string | null;
  age: number | null;
  status: string;
  priority: number;
  scoutRating: number | null;
  notes: string | null;
  minutes: number | null;
  confidence: string | null;
}

type SortKey = 'priority' | 'name' | 'status' | 'rating' | 'minutes';

export function ShortlistPlayers({
  shortlistId,
  entries,
  canEdit,
}: {
  shortlistId: string;
  entries: ShortlistEntry[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('priority');
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const update = async (playerId: string, patch: Record<string, unknown>) => {
    setBusy(playerId);
    setError(null);
    const response = await fetch('/api/v1/shortlists', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shortlistId, playerId, ...patch }),
    });
    setBusy(null);
    if (!response.ok) {
      setError('Could not save that change.');
      return false;
    }
    router.refresh();
    return true;
  };

  const remove = async (playerId: string) => {
    setBusy(playerId);
    setError(null);
    const response = await fetch(
      `/api/v1/shortlists?shortlistId=${shortlistId}&playerId=${playerId}`,
      { method: 'DELETE' },
    );
    setBusy(null);
    if (!response.ok) setError('Could not remove that player.');
    else router.refresh();
  };

  const sorted = [...entries].sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.playerName.localeCompare(b.playerName);
      case 'status':
        return STATUSES.indexOf(b.status as ShortlistStatus) -
          STATUSES.indexOf(a.status as ShortlistStatus);
      case 'rating':
        return (b.scoutRating ?? -1) - (a.scoutRating ?? -1);
      case 'minutes':
        return (b.minutes ?? -1) - (a.minutes ?? -1);
      default:
        return a.priority - b.priority;
    }
  });

  if (entries.length === 0) {
    return (
      <Empty>
        No players yet. Open a player and use the &ldquo;Add to shortlist&rdquo; button, or search
        for one below.
      </Empty>
    );
  }

  const cell = 'px-2 py-2 align-top text-sm';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-ink-500">
        Sort by
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          className="rounded-md border border-ink-300 px-2 py-1 text-xs outline-none focus:border-brand-500"
        >
          <option value="priority">Priority</option>
          <option value="status">Status</option>
          <option value="rating">Scout rating</option>
          <option value="minutes">Minutes</option>
          <option value="name">Name</option>
        </select>
        {error && <span className="ml-2 font-medium text-bad">{error}</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-200">
              {['Player', 'Pos', 'Age', 'Status', 'Priority', 'Rating', 'Minutes', 'Data', ''].map(
                (label) => (
                  <th
                    key={label}
                    className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {sorted.map((entry) => (
              <Fragment key={entry.id}>
                <tr className="hover:bg-ink-50">
                  <td className={cell}>
                    <Link
                      href={`/players/${entry.playerId}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {entry.playerName}
                    </Link>
                  </td>
                  <td className={cell}>{entry.position ?? '-'}</td>
                  <td className={`${cell} tabular`}>{entry.age ?? '-'}</td>

                  <td className={cell}>
                    {canEdit ? (
                      <select
                        value={entry.status}
                        disabled={busy === entry.playerId}
                        onChange={(event) =>
                          void update(entry.playerId, { status: event.target.value })
                        }
                        className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          STATUS_TONE[entry.status] ?? 'bg-ink-100 text-ink-600'
                        }`}
                      >
                        {entry.status}
                      </span>
                    )}
                  </td>

                  <td className={cell}>
                    {canEdit ? (
                      <select
                        value={entry.priority}
                        disabled={busy === entry.playerId}
                        onChange={(event) =>
                          void update(entry.playerId, { priority: Number(event.target.value) })
                        }
                        className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
                      >
                        {[1, 2, 3, 4, 5].map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      entry.priority
                    )}
                  </td>

                  <td className={cell}>
                    {canEdit ? (
                      <select
                        value={entry.scoutRating ?? ''}
                        disabled={busy === entry.playerId}
                        onChange={(event) =>
                          void update(entry.playerId, {
                            scoutRating: event.target.value ? Number(event.target.value) : undefined,
                          })
                        }
                        className="rounded-md border border-ink-300 px-1.5 py-1 text-xs outline-none focus:border-brand-500"
                      >
                        <option value="">-</option>
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (entry.scoutRating ?? '-')
                    )}
                  </td>

                  <td className={`${cell} tabular`}>{entry.minutes ?? '-'}</td>
                  <td className={cell}>
                    {entry.confidence && <ConfidenceBadge confidence={entry.confidence} />}
                  </td>

                  <td className={`${cell} text-right`}>
                    {canEdit && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(editing === entry.id ? null : entry.id);
                            setNoteDraft(entry.notes ?? '');
                          }}
                          className="text-xs font-medium text-ink-500 hover:text-ink-800"
                        >
                          {entry.notes ? 'Note' : 'Add note'}
                        </button>
                        <button
                          type="button"
                          disabled={busy === entry.playerId}
                          onClick={() => void remove(entry.playerId)}
                          className="text-xs font-medium text-ink-400 hover:text-bad disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>

                {(entry.notes || editing === entry.id) && (
                  <tr>
                    <td colSpan={9} className="px-2 pb-2">
                      {editing === entry.id ? (
                        <form
                          className="flex items-start gap-2"
                          onSubmit={async (event) => {
                            event.preventDefault();
                            const ok = await update(entry.playerId, { notes: noteDraft });
                            if (ok) setEditing(null);
                          }}
                        >
                          <textarea
                            value={noteDraft}
                            onChange={(event) => setNoteDraft(event.target.value)}
                            rows={2}
                            className="w-full rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                          />
                          <button
                            type="submit"
                            disabled={busy === entry.playerId}
                            className="rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        <p className="border-l-2 border-ink-200 pl-2 text-sm text-ink-600">
                          {entry.notes}
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
