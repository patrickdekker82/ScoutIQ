'use client';

import { useState } from 'react';

/**
 * Queue a report (§50, §51).
 *
 * Which subject is passed decides the kind of report; the server refuses a
 * request that names none or more than one.
 */
export function GenerateReportButton({
  playerId,
  playerIds,
  teamId,
  matchId,
  label = 'Generate PDF report',
}: {
  playerId?: string;
  playerIds?: string[];
  teamId?: string;
  matchId?: string;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'queued' | 'error'>('idle');

  const subject = playerIds
    ? { playerIds }
    : teamId
      ? { teamId }
      : matchId
        ? { matchId }
        : { playerId };

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
            body: JSON.stringify({ ...subject, background: true, includePdf: true }),
          });
          setState(response.ok ? 'queued' : 'error');
        }}
        className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {state === 'working' ? 'Queueing...' : label}
      </button>
      {state === 'queued' && (
        <p className="mt-1 text-xs text-good">
          Queued. It will appear under Reports once the worker finishes.
        </p>
      )}
      {state === 'error' && <p className="mt-1 text-xs text-bad">Could not queue the report.</p>}
    </div>
  );
}
