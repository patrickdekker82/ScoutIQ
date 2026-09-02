'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';

const DATASETS = [
  'players',
  'player_match_stats',
  'player_percentiles',
  'teams',
  'team_match_stats',
  'matches',
  'events',
  'metrics',
  'heatmap_zones',
  'roles',
  'similarity',
  'club_fit',
  'shortlists',
];

/** Dataset exports (§9, §78). */
export function ExportPanel() {
  const [dataset, setDataset] = useState('players');
  const [format, setFormat] = useState('csv');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field = 'rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

  return (
    <Card title="Export data" subtitle="CSV, JSON or SQL, written to EXPORT_ROOT">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setResult(null);

          const response = await fetch('/api/v1/exports', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dataset, format, background: false }),
          });

          setBusy(false);
          if (response.ok) {
            const body = (await response.json()) as { key: string; rowCount: number; bytes: number };
            setResult(`${body.rowCount} rows → ${body.key} (${(body.bytes / 1024).toFixed(1)} KB)`);
          } else {
            setResult('Export failed.');
          }
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Dataset
          <select
            value={dataset}
            onChange={(event) => setDataset(event.target.value)}
            className={`mt-1 block w-56 ${field}`}
          >
            {DATASETS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            className={`mt-1 block w-28 ${field}`}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="sql">SQL</option>
          </select>
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? 'Exporting...' : 'Export'}
        </button>

        {result && <p className="text-xs text-ink-600">{result}</p>}
      </form>
    </Card>
  );
}
