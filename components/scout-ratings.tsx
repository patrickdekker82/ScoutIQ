'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Empty } from '@/components/ui';

/**
 * Manual scout ratings (§49).
 *
 * Deliberately walled off from the analytics: these are opinions, and the page
 * says so. They are shown next to the computed scores, never blended into them.
 */

const FIELDS = [
  { key: 'technical', label: 'Technical' },
  { key: 'tactical', label: 'Tactical' },
  { key: 'physical', label: 'Physical' },
  { key: 'mental', label: 'Mental' },
  { key: 'potential', label: 'Potential' },
  { key: 'overall', label: 'Overall' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

export interface ScoutRatingRow {
  id: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  matchLabel: string | null;
  notes: string | null;
  technical: number;
  tactical: number;
  physical: number;
  mental: number;
  potential: number;
  overall: number;
}

const DEFAULTS: Record<FieldKey, number> = {
  technical: 60,
  tactical: 60,
  physical: 60,
  mental: 60,
  potential: 60,
  overall: 60,
};

function Bar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-ink-400" style={{ width: `${value}%` }} />
      </div>
      <span className="tabular w-7 text-right text-xs text-ink-600">{value}</span>
    </div>
  );
}

export function ScoutRatings({
  playerId,
  ratings,
  canRate,
  selfId,
  isAdmin,
}: {
  playerId: string;
  ratings: ScoutRatingRow[];
  canRate: boolean;
  selfId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<FieldKey, number>>(DEFAULTS);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An average of opinions is still an opinion, and it is only worth showing
  // once more than one scout has weighed in.
  const consensus =
    ratings.length > 1
      ? Object.fromEntries(
          FIELDS.map((field) => [
            field.key,
            Math.round(
              ratings.reduce((sum, rating) => sum + rating[field.key], 0) / ratings.length,
            ),
          ]),
        )
      : null;

  return (
    <div className="space-y-4">
      <p className="rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600">
        These are human judgements recorded by scouts. They are kept separate from every computed
        score on this page and never feed the analytics (§49).
      </p>

      {ratings.length === 0 ? (
        <Empty>No scout has rated this player yet.</Empty>
      ) : (
        <>
          {consensus && (
            <div className="rounded-md border border-ink-200 px-3 py-2">
              <div className="mb-1.5 text-xs font-medium text-ink-700">
                Average across {ratings.length} scouts
              </div>
              <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-ink-600">{field.label}</span>
                    <Bar value={consensus[field.key] as number} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <ul className="space-y-3">
            {ratings.map((rating) => (
              <li key={rating.id} className="rounded-md border border-ink-200 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-ink-900">
                    {rating.authorName}
                    <span className="ml-2 text-xs font-normal text-ink-500">
                      {new Date(rating.createdAt).toLocaleDateString()}
                      {rating.matchLabel && ` · ${rating.matchLabel}`}
                    </span>
                  </div>
                  {(rating.authorId === selfId || isAdmin) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        const response = await fetch(`/api/v1/ratings/${rating.id}`, {
                          method: 'DELETE',
                        });
                        setBusy(false);
                        if (response.ok) router.refresh();
                        else setError('Could not remove that rating.');
                      }}
                      className="text-xs font-medium text-ink-400 hover:text-bad disabled:opacity-60"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="mt-1.5 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                  {FIELDS.map((field) => (
                    <div key={field.key} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-ink-600">{field.label}</span>
                      <Bar value={rating[field.key]} />
                    </div>
                  ))}
                </div>

                {rating.notes && <p className="mt-2 text-sm text-ink-700">{rating.notes}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {canRate && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-md border border-ink-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            {open ? 'Cancel' : 'Add a rating'}
          </button>

          {open && (
            <form
              className="mt-3 space-y-3 rounded-md border border-ink-200 p-3"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setError(null);
                const response = await fetch('/api/v1/ratings', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    playerId,
                    ...values,
                    notes: notes.trim() || undefined,
                  }),
                });
                setBusy(false);
                if (!response.ok) {
                  setError('Could not save that rating.');
                  return;
                }
                setOpen(false);
                setValues(DEFAULTS);
                setNotes('');
                router.refresh();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((field) => (
                  <label key={field.key} className="block">
                    <span className="flex items-baseline justify-between text-xs font-medium uppercase tracking-wide text-ink-500">
                      {field.label}
                      <span className="tabular text-sm font-semibold text-ink-800">
                        {values[field.key]}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={100}
                      value={values[field.key]}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: Number(event.target.value),
                        }))
                      }
                      className="mt-1 w-full accent-brand-600"
                    />
                  </label>
                ))}
              </div>

              <label className="block text-xs font-medium uppercase tracking-wide text-ink-500">
                Notes
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder="What you saw, and in what context."
                  className="mt-1 block w-full rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                />
              </label>

              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? 'Saving...' : 'Save rating'}
              </button>
            </form>
          )}
        </div>
      )}

      {error && <p className="text-xs font-medium text-bad">{error}</p>}
    </div>
  );
}
