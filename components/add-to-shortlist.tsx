'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Put a player on a shortlist from their own page (§47). */
export function AddToShortlist({
  playerId,
  shortlists,
}: {
  playerId: string;
  shortlists: { id: string; name: string; contains: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  if (shortlists.length === 0) {
    return (
      <a
        href="/shortlists"
        className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
      >
        Create a shortlist
      </a>
    );
  }

  const add = async (shortlistId: string) => {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/v1/shortlists', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shortlistId, playerId }),
    });
    setBusy(false);
    if (!response.ok) {
      setError('Could not add to that list.');
      return;
    }
    setAdded((current) => [...current, shortlistId]);
    router.refresh();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-md border border-ink-300 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
      >
        Add to shortlist
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg">
          <ul className="max-h-64 overflow-auto">
            {shortlists.map((shortlist) => {
              const on = shortlist.contains || added.includes(shortlist.id);
              return (
                <li key={shortlist.id}>
                  <button
                    type="button"
                    disabled={busy || on}
                    onClick={() => void add(shortlist.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink-800 hover:bg-ink-50 disabled:text-ink-400"
                  >
                    {shortlist.name}
                    {on && <span className="text-[11px] uppercase text-ink-400">on list</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {error && <p className="px-3 py-1.5 text-xs font-medium text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}
