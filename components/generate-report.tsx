'use client';

import { useState } from 'react';

/** Queue a PDF scouting report (§50, §51). */
export function GenerateReportButton({ playerId }: { playerId: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'queued' | 'error'>('idle');

  return (
    <div className="text-right">
      <button
        type="button"
        disabled={state === 'working'}
        onClick={async () => {
          setState('working');
          const response = await fetch('/api/v1/reports', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ playerId, background: true, includePdf: true }),
          });
          setState(response.ok ? 'queued' : 'error');
        }}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {state === 'working' ? 'Queueing...' : 'Generate PDF report'}
      </button>
      {state === 'queued' && (
        <p className="mt-1 text-xs text-good">
          Queued. It will appear under Reports once the worker finishes.
        </p>
      )}
      {state === 'error' && (
        <p className="mt-1 text-xs text-bad">Could not queue the report.</p>
      )}
    </div>
  );
}
