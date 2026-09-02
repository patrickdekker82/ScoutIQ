'use client';

import { useState } from 'react';
import { Card, Empty } from '@/components/ui';

/**
 * SQL console (§23).
 *
 * SELECT-only. The restriction is enforced server-side twice - by a parser and
 * by a READ ONLY transaction - so nothing typed here can change data.
 */

interface HistoryEntry {
  id: string;
  sql: string;
  rowCount: number;
  durationMs: number;
  success: boolean;
}

interface SavedQuery {
  id: string;
  name: string;
  sql: string;
}

interface Result {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

const EXAMPLES = [
  {
    label: 'Top progressive passers',
    sql: `SELECT player_name, team_name, minutes, progressive_passes_p90
FROM vw_player_season_stats
WHERE position_group IN ('DF','MF') AND minutes >= 450
ORDER BY progressive_passes_p90 DESC
LIMIT 25;`,
  },
  {
    label: 'Best U21 by xG+xA',
    sql: `SELECT player_name, age, team_name, xg_p90, xa_p90, (xg_p90 + xa_p90) AS xgi_p90
FROM vw_player_season_stats
WHERE age <= 21 AND minutes >= 450
ORDER BY xgi_p90 DESC
LIMIT 25;`,
  },
  {
    label: 'Team tactical comparison',
    sql: `SELECT team_name, possession, high_press, directness, chance_creation, defensive_compactness
FROM vw_team_style_profiles
ORDER BY possession DESC;`,
  },
  {
    label: 'Player event distribution',
    sql: `SELECT e.type, count(*) AS events
FROM events e
JOIN players p ON p.id = e."playerId"
GROUP BY e.type
ORDER BY events DESC;`,
  },
];

export function SqlConsole({ history, saved }: { history: HistoryEntry[]; saved: SavedQuery[] }) {
  const [sql, setSql] = useState(EXAMPLES[0]?.sql ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);

    const response = await fetch('/api/v1/sql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    });

    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setResult(body as Result);
    } else {
      setResult(null);
      setError((body as { message?: string; error?: string }).message ?? 'Query failed.');
    }
    setBusy(false);
  }

  function download(format: 'csv' | 'json') {
    if (!result) return;

    const content =
      format === 'json'
        ? JSON.stringify(result.rows, null, 2)
        : [
            result.columns.join(','),
            ...result.rows.map((row) =>
              result.columns
                .map((column) => {
                  const value = row[column];
                  const text = value === null || value === undefined ? '' : String(value);
                  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
                })
                .join(','),
            ),
          ].join('\n');

    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `scoutiq-query.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <Card
        title="SQL console"
        subtitle="Read-only. PostgreSQL is a first-class product here - query it directly."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? 'Running...' : 'Run query'}
            </button>
          </div>
        }
      >
        <textarea
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          spellCheck={false}
          rows={10}
          className="w-full rounded-md border border-ink-300 bg-ink-900 p-3 font-mono text-[13px] leading-relaxed text-ink-100 outline-none focus:border-brand-500"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => setSql(example.sql)}
              className="rounded-md border border-ink-300 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50"
            >
              {example.label}
            </button>
          ))}
          {saved.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSql(entry.sql)}
              className="rounded-md border border-brand-300 bg-brand-50 px-2 py-1 text-xs text-brand-700"
            >
              {entry.name}
            </button>
          ))}
        </div>

        {error && (
          <p className="mt-3 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 font-mono text-xs text-bad">
            {error}
          </p>
        )}
      </Card>

      {result && (
        <Card
          title="Results"
          subtitle={`${result.rowCount} rows in ${result.durationMs} ms${
            result.truncated ? ' (truncated)' : ''
          }`}
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => download('csv')}
                className="rounded-md border border-ink-300 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => download('json')}
                className="rounded-md border border-ink-300 px-2 py-1 text-xs text-ink-600 hover:bg-ink-50"
              >
                JSON
              </button>
            </div>
          }
        >
          {result.rows.length === 0 ? (
            <Empty>The query returned no rows.</Empty>
          ) : (
            <div className="-mx-4 max-h-[32rem] overflow-auto px-4">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    {result.columns.map((column) => (
                      <th
                        key={column}
                        className="whitespace-nowrap border-b border-ink-200 px-2 py-1.5 text-left font-semibold uppercase tracking-wide text-ink-500"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index} className="hover:bg-ink-50">
                      {result.columns.map((column) => (
                        <td
                          key={column}
                          className="tabular whitespace-nowrap border-b border-ink-100 px-2 py-1"
                        >
                          {formatCell(row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card title="Query history" subtitle="Your last 20 queries">
        {history.length === 0 ? (
          <Empty>No queries run yet.</Empty>
        ) : (
          <ul className="space-y-1.5">
            {history.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-xs">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-semibold ${
                    entry.success ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'
                  }`}
                >
                  {entry.success ? `${entry.rowCount} rows` : 'error'}
                </span>
                <button
                  type="button"
                  onClick={() => setSql(entry.sql)}
                  className="truncate text-left font-mono text-ink-600 hover:text-brand-600"
                >
                  {entry.sql.replace(/\s+/g, ' ').slice(0, 120)}
                </button>
                <span className="ml-auto shrink-0 text-ink-400">{entry.durationMs} ms</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
