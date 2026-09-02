'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewShortlistForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const response = await fetch('/api/v1/shortlists', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, description: description || undefined }),
        });
        setBusy(false);
        if (response.ok) {
          setName('');
          setDescription('');
          router.refresh();
        }
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
        Name
        <input
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Left-footed centre backs, U23"
          className="mt-1 block w-64 rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
      </label>

      <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
        Description
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1 block w-80 rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
        />
      </label>

      <button
        type="submit"
        disabled={busy || name.length === 0}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        Create
      </button>
    </form>
  );
}
