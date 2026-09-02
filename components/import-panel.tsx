'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/ui';

interface ProviderSummary {
  key: string;
  name: string;
  configured: boolean;
  capabilities: Record<string, boolean>;
}

/** Trigger an import (§55). The work runs in the worker, not in this request. */
export function ImportPanel({ providers }: { providers: ProviderSummary[] }) {
  const router = useRouter();
  const available = providers.filter((provider) => provider.configured);

  const [providerKey, setProviderKey] = useState(available[0]?.key ?? '');
  const [competition, setCompetition] = useState('');
  const [season, setSeason] = useState('');
  const [matchLimit, setMatchLimit] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field = 'rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

  return (
    <Card title="Run an import" subtitle="Queued to the worker; progress appears under Jobs">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);

          const response = await fetch('/api/v1/imports', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              providerKey,
              ...(competition ? { competitionExternalId: competition } : {}),
              ...(season ? { seasonExternalId: season } : {}),
              ...(matchLimit ? { matchLimit: Number(matchLimit) } : {}),
            }),
          });

          setBusy(false);
          setMessage(
            response.ok
              ? 'Import queued. Watch it under Jobs.'
              : 'Could not queue the import - check your role and the provider configuration.',
          );
          if (response.ok) router.refresh();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Provider
          <select
            value={providerKey}
            onChange={(event) => setProviderKey(event.target.value)}
            className={`mt-1 block w-56 ${field}`}
          >
            {available.map((provider) => (
              <option key={provider.key} value={provider.key}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Competition id
          <input
            value={competition}
            onChange={(event) => setCompetition(event.target.value)}
            placeholder="optional"
            className={`mt-1 block w-32 ${field}`}
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Season id
          <input
            value={season}
            onChange={(event) => setSeason(event.target.value)}
            placeholder="optional"
            className={`mt-1 block w-32 ${field}`}
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Match limit
          <input
            type="number"
            value={matchLimit}
            onChange={(event) => setMatchLimit(event.target.value)}
            placeholder="all"
            className={`mt-1 block w-24 ${field}`}
          />
        </label>

        <button
          type="submit"
          disabled={busy || !providerKey}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Queueing...' : 'Queue import'}
        </button>

        {message && <p className="text-xs text-ink-500">{message}</p>}
      </form>
    </Card>
  );
}
