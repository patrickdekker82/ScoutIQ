'use client';

import { useState } from 'react';

/**
 * Run one named export and say where the file landed (§78).
 *
 * ScoutIQ writes exports into its own storage rather than streaming them to the
 * browser: the same file is then available to the worker, the archive and the
 * NAS, and a large export does not depend on a browser tab staying open.
 */
export function ExportButton({
  dataset,
  format = 'csv',
  label,
}: {
  dataset: string;
  format?: 'csv' | 'json' | 'sql';
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [path, setPath] = useState<string | null>(null);

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={state === 'working'}
        onClick={async () => {
          setState('working');
          setPath(null);
          const response = await fetch('/api/v1/exports', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dataset, format, background: false }),
          });
          if (!response.ok) {
            setState('error');
            return;
          }
          const body = (await response.json()) as { key?: string; rowCount?: number };
          setState('idle');
          setPath(body.key ? `${body.key} (${body.rowCount ?? 0} rows)` : null);
        }}
        className="rounded-md border border-ink-300 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
      >
        {state === 'working' ? 'Exporting...' : (label ?? `Export ${format.toUpperCase()}`)}
      </button>

      {path && <p className="mt-1 text-[11px] text-good">Written to exports/{path}</p>}
      {state === 'error' && <p className="mt-1 text-[11px] text-bad">Export failed.</p>}
    </div>
  );
}
