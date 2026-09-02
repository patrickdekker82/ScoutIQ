'use client';

import { useEffect, useState } from 'react';
import { Card, Empty, Table, Td, Th } from '@/components/ui';

interface Job {
  id: string | null;
  name: string | null;
  state: string;
  progress: number | object;
  attemptsMade: number;
  timestamp: number | null;
  durationMs: number | null;
  failedReason: string | null;
}

interface Schedule {
  key: string;
  name?: string;
  pattern?: string | null;
  next?: number | null;
}

interface Payload {
  counts: Record<string, Record<string, number>>;
  jobs: Job[];
  schedules: Schedule[];
}

const STATE_TONE: Record<string, string> = {
  active: 'bg-brand-100 text-brand-700',
  waiting: 'bg-ink-100 text-ink-600',
  completed: 'bg-good/10 text-good',
  failed: 'bg-bad/10 text-bad',
};

export function JobDashboard() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const response = await fetch('/api/v1/jobs').catch(() => null);
      if (response?.ok && active) setData(await response.json());
    }

    void load();
    // Jobs are long-running; polling every few seconds is enough and avoids a
    // websocket for a single-operator tool.
    const timer = setInterval(() => void load(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!data) return <div className="h-40 animate-pulse rounded-lg bg-ink-100" />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(data.counts).map(([queue, counts]) => (
          <div key={queue} className="rounded-lg border border-ink-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{queue}</div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {Object.entries(counts).map(([state, count]) => (
                <div key={state} className="flex justify-between">
                  <span className="text-ink-500">{state}</span>
                  <span className="tabular font-semibold text-ink-800">{count}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <Card title="Recent jobs" subtitle="Refreshes every few seconds">
        {data.jobs.length === 0 ? (
          <Empty>No jobs yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>State</Th>
                <Th align="right">Progress</Th>
                <Th align="right">Attempts</Th>
                <Th align="right">Duration</Th>
                <Th>Error</Th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((job, index) => (
                <tr key={`${job.id}-${index}`} className="hover:bg-ink-50">
                  <Td>{job.name ?? '-'}</Td>
                  <Td>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        STATE_TONE[job.state] ?? 'bg-ink-100 text-ink-600'
                      }`}
                    >
                      {job.state}
                    </span>
                  </Td>
                  <Td align="right">
                    {typeof job.progress === 'number' ? `${job.progress}%` : '-'}
                  </Td>
                  <Td align="right">{job.attemptsMade}</Td>
                  <Td align="right">
                    {job.durationMs !== null ? `${(job.durationMs / 1000).toFixed(1)}s` : '-'}
                  </Td>
                  <Td className="max-w-xs truncate text-xs text-bad">{job.failedReason ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Schedules" subtitle="Stored in Redis, so they travel with the deployment">
        {data.schedules.length === 0 ? (
          <Empty>
            No schedules registered. Set{' '}
            <code className="rounded bg-ink-100 px-1">SCHEDULER_ENABLED=true</code> and run the
            scheduler service.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Pattern</Th>
                <Th>Next run</Th>
              </tr>
            </thead>
            <tbody>
              {data.schedules.map((schedule) => (
                <tr key={schedule.key}>
                  <Td>{schedule.key}</Td>
                  <Td>
                    <code className="rounded bg-ink-100 px-1 py-0.5 text-[11px]">
                      {schedule.pattern ?? '-'}
                    </code>
                  </Td>
                  <Td>{schedule.next ? new Date(schedule.next).toISOString().slice(0, 16).replace('T', ' ') : '-'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
