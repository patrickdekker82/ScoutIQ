'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card, Empty } from '@/components/ui';

/**
 * External API synchronisation schedules (§88 phase 8).
 *
 * The page shows the watermark and the last error verbatim: a sync that has
 * quietly been failing for a week is the failure mode this screen exists to
 * prevent.
 */

export interface SyncScheduleRow {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  competitionExternalId: string | null;
  seasonExternalId: string | null;
  includeEvents: boolean;
  includeTracking: boolean;
  matchLimit: number | null;
  overlapHours: number;
  watermark: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  providerKey: string;
  providerName: string;
  providerConfigured: boolean;
}

export interface SyncProviderOption {
  key: string;
  name: string;
  configured: boolean;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

const inputClass =
  'mt-1 block rounded-md border border-ink-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500';

const when = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : 'Never';

export function SyncSchedules({
  schedules,
  providers,
}: {
  schedules: SyncScheduleRow[];
  providers: SyncProviderOption[];
}) {
  const router = useRouter();
  const [providerKey, setProviderKey] = useState(providers[0]?.key ?? '');
  const [name, setName] = useState('');
  const [cron, setCron] = useState('0 4 * * *');
  const [competitionExternalId, setCompetition] = useState('');
  const [seasonExternalId, setSeason] = useState('');
  const [overlapHours, setOverlap] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (
    id: string,
    method: 'PATCH' | 'DELETE' | 'POST',
    body?: Record<string, unknown>,
    suffix = '',
  ) => {
    setBusy(id);
    setError(null);
    setNotice(null);
    const response = await fetch(`/api/v1/sync/schedules/${id}${suffix}`, {
      method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    setBusy(null);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    if (suffix === '/run') setNotice('Queued. Watch the Jobs page for progress.');
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <Card
        title="External API synchronisation"
        subtitle="Recurring incremental syncs from commercial providers (§88 phase 8)"
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy('new');
            setError(null);
            setNotice(null);
            const response = await fetch('/api/v1/sync/schedules', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                providerKey,
                name,
                cron,
                competitionExternalId: competitionExternalId || undefined,
                seasonExternalId: seasonExternalId || undefined,
                overlapHours,
              }),
            });
            setBusy(null);
            if (!response.ok) {
              setError(await readError(response));
              return;
            }
            setName('');
            setCompetition('');
            setSeason('');
            router.refresh();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Provider
            <select
              value={providerKey}
              onChange={(event) => setProviderKey(event.target.value)}
              className={`${inputClass} w-44`}
            >
              {providers.map((provider) => (
                <option key={provider.key} value={provider.key}>
                  {provider.name}
                  {provider.configured ? '' : ' (no API key)'}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Eredivisie 2025/26"
              className={`${inputClass} w-52`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Competition id
            <input
              value={competitionExternalId}
              onChange={(event) => setCompetition(event.target.value)}
              placeholder="Provider's id"
              className={`${inputClass} w-36`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Season id
            <input
              value={seasonExternalId}
              onChange={(event) => setSeason(event.target.value)}
              placeholder="Provider's id"
              className={`${inputClass} w-36`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Cron (UTC)
            <input
              required
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              className={`${inputClass} w-32`}
            />
          </label>

          <label className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Overlap (h)
            <input
              type="number"
              min={0}
              max={720}
              value={overlapHours}
              onChange={(event) => setOverlap(Number(event.target.value) || 0)}
              className={`${inputClass} w-24`}
            />
          </label>

          <button
            type="submit"
            disabled={busy === 'new' || providers.length === 0}
            className="rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            Add schedule
          </button>
        </form>

        <p className="mt-2 text-xs text-ink-500">
          Each run asks the provider for matches after the watermark minus the overlap window, so a
          fixture corrected after the fact is still picked up. The watermark only advances after a
          run that completed cleanly.
        </p>
        {error && <p className="mt-2 text-xs font-medium text-bad">{error}</p>}
        {notice && <p className="mt-2 text-xs font-medium text-good">{notice}</p>}
      </Card>

      <Card title="Schedules" subtitle={`${schedules.length} configured`}>
        {schedules.length === 0 ? (
          <Empty>
            No external synchronisation configured. Open-data providers are imported from the panel
            above this one; these schedules are for the commercial APIs.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className={`rounded-md border px-3 py-2.5 ${
                  schedule.enabled ? 'border-ink-200' : 'border-ink-200 bg-ink-50 text-ink-500'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-ink-900">
                      {schedule.name}
                      <span className="ml-2 text-xs font-normal text-ink-500">
                        {schedule.providerName} &middot; {schedule.cron} UTC
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      {schedule.competitionExternalId && (
                        <>competition {schedule.competitionExternalId} &middot; </>
                      )}
                      {schedule.seasonExternalId && <>season {schedule.seasonExternalId} &middot; </>}
                      overlap {schedule.overlapHours}h &middot; watermark{' '}
                      {schedule.watermark
                        ? new Date(schedule.watermark).toISOString().slice(0, 10)
                        : 'none (full sync)'}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-500">
                      Last run {when(schedule.lastRunAt)}
                      {schedule.lastStatus && ` - ${schedule.lastStatus.toLowerCase()}`}
                      {schedule.consecutiveFailures > 0 &&
                        ` - ${schedule.consecutiveFailures} consecutive failure${
                          schedule.consecutiveFailures === 1 ? '' : 's'
                        }`}
                    </div>
                    {schedule.lastError && (
                      <div className="mt-1 max-w-2xl text-xs text-bad">{schedule.lastError}</div>
                    )}
                    {!schedule.providerConfigured && (
                      <div className="mt-1 text-xs text-warn">
                        This provider has no API key configured, so runs are skipped rather than
                        failed.
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy === schedule.id}
                      onClick={() => void act(schedule.id, 'POST', undefined, '/run')}
                      className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
                    >
                      Run now
                    </button>
                    <button
                      type="button"
                      disabled={busy === schedule.id}
                      onClick={() => void act(schedule.id, 'PATCH', { enabled: !schedule.enabled })}
                      className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
                    >
                      {schedule.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      disabled={busy === schedule.id}
                      onClick={() => void act(schedule.id, 'PATCH', { watermark: null })}
                      title="Clear the watermark so the next run re-reads the whole season"
                      className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-60"
                    >
                      Full re-sync
                    </button>
                    <button
                      type="button"
                      disabled={busy === schedule.id}
                      onClick={() => void act(schedule.id, 'DELETE')}
                      className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-bad hover:bg-bad/10 disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
