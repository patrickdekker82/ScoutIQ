'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Empty } from '@/components/ui';

/**
 * File upload and CSV/JSON import (§55).
 *
 * Upload and import are two steps on purpose. A file lands in the inbox, can be
 * inspected there - columns, a sample, duplicate ids, empty columns - and only
 * then handed to the importer. A bad spreadsheet should be caught by a human
 * reading three rows, not by a failed import.
 */

interface InboxFile {
  name: string;
  bytes: number;
}

interface CsvPreview {
  name: string;
  format: 'csv';
  readAs: string | null;
  rows: number;
  columns: string[];
  sample: Record<string, string>[];
  idColumn: string | null;
  duplicates: { value: string; count: number }[];
  blankColumns: string[];
}

interface JsonPreview {
  name: string;
  format: 'json';
  counts?: Record<string, number>;
  sample?: Record<string, unknown>;
  error?: string;
}

type Preview = CsvPreview | JsonPreview;

const humanBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function FileImport() {
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/v1/imports/files').catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as { files: InboxFile[] };
      setFiles(body.files);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/v1/imports/files', { method: 'POST', body: form });
    setBusy(false);

    if (!response.ok) {
      try {
        const body = (await response.json()) as { message?: string };
        setError(body.message ?? `Upload failed (${response.status})`);
      } catch {
        setError(`Upload failed (${response.status})`);
      }
      return;
    }

    setNotice(`${file.name} is in the inbox. Inspect it, then run a CSV / JSON import.`);
    await refresh();
    await inspect(file.name);
  };

  const inspect = async (name: string) => {
    setError(null);
    const response = await fetch(
      `/api/v1/imports/files/preview?name=${encodeURIComponent(name)}`,
    ).catch(() => null);
    if (response?.ok) setPreview((await response.json()) as Preview);
    else setError('Could not read that file.');
  };

  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/v1/imports/files?name=${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!response.ok) {
      setError('Could not remove that file.');
      return;
    }
    if (preview?.name === name) setPreview(null);
    setNotice(`${name} removed from the inbox.`);
    await refresh();
  };

  return (
    <Card
      title="File upload"
      subtitle="CSV and JSON land in the import inbox, where the file provider reads them (§55)"
      actions={
        <div className="flex items-center gap-2">
          <input
            ref={input}
            type="file"
            accept=".csv,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Working...' : 'Choose a file'}
          </button>
        </div>
      }
    >
      <p className="text-xs text-ink-500">
        A CSV is read according to its name: <code className="rounded bg-ink-100 px-1">players</code>
        , <code className="rounded bg-ink-100 px-1">teams</code> or{' '}
        <code className="rounded bg-ink-100 px-1">events</code>, optionally followed by a hyphen and
        anything you like - <code className="rounded bg-ink-100 px-1">players-eredivisie.csv</code>.
        A JSON file may carry any of those keys at the top level. Uploading does not import: run the
        CSV / JSON provider above once the files look right.
      </p>

      {error && <p className="mt-2 text-xs font-medium text-bad">{error}</p>}
      {notice && <p className="mt-2 text-xs font-medium text-good">{notice}</p>}

      <div className="mt-3">
        {files.length === 0 ? (
          <Empty>The import inbox is empty.</Empty>
        ) : (
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
            {files.map((file) => (
              <li key={file.name} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="text-sm text-ink-800">
                  {file.name}
                  <span className="ml-2 text-xs text-ink-400">{humanBytes(file.bytes)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void inspect(file.name)}
                    className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100"
                  >
                    Inspect
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(file.name)}
                    className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-bad hover:bg-bad/10 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview && (
        <div className="mt-4 rounded-md border border-ink-200 p-3">
          <div className="text-sm font-medium text-ink-900">{preview.name}</div>

          {preview.format === 'json' ? (
            preview.error ? (
              <p className="mt-1 text-xs font-medium text-bad">
                This file is not valid JSON: {preview.error}
              </p>
            ) : (
              <>
                <p className="mt-1 text-xs text-ink-500">
                  {Object.entries(preview.counts ?? {})
                    .map(([key, count]) => `${count} ${key}`)
                    .join(', ') || 'No recognised top-level keys.'}
                </p>
                <pre className="mt-2 max-h-56 overflow-auto rounded bg-ink-50 p-2 text-[11px] text-ink-700">
                  {JSON.stringify(preview.sample, null, 2)}
                </pre>
              </>
            )
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-500">
                {preview.rows} rows, {preview.columns.length} columns
                {preview.readAs
                  ? ` · will be read as ${preview.readAs}`
                  : ' · the name does not start with players, teams or events, so the importer will skip it'}
              </p>

              {preview.duplicates.length > 0 && (
                <p className="mt-1 text-xs text-warn">
                  Duplicate {preview.idColumn} values in this file:{' '}
                  {preview.duplicates
                    .map((entry) => `${entry.value} (x${entry.count})`)
                    .join(', ')}
                  . Entity resolution will merge them; check that they really are the same thing.
                </p>
              )}
              {preview.blankColumns.length > 0 && (
                <p className="mt-1 text-xs text-warn">
                  Columns with no values at all: {preview.blankColumns.join(', ')}.
                </p>
              )}

              {preview.sample.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-ink-200">
                        {preview.columns.map((column) => (
                          <th
                            key={column}
                            className="whitespace-nowrap px-2 py-1 font-semibold uppercase tracking-wide text-ink-500"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {preview.sample.map((row, index) => (
                        <tr key={index}>
                          {preview.columns.map((column) => (
                            <td key={column} className="whitespace-nowrap px-2 py-1 text-ink-700">
                              {row[column] || <span className="text-ink-300">-</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
