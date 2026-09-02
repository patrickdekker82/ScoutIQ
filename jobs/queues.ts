import { Queue, type JobsOptions } from 'bullmq';
import { createRedis } from '@/lib/redis';

/**
 * Queue definitions (§56).
 *
 * Producers (web) and consumers (worker) share only Redis, so they can run in
 * one container today and on separate machines later without a code change.
 *
 * Queue names carry no colon: BullMQ reserves it as its key separator. The
 * shared prefix namespaces ScoutIQ inside a Redis instance it may share.
 */
export const QUEUE_PREFIX = 'scoutiq';

export const QUEUE_IMPORT = 'import';
export const QUEUE_ANALYTICS = 'analytics';
export const QUEUE_EXPORT = 'export';
export const QUEUE_REPORT = 'report';
export const QUEUE_MAINTENANCE = 'maintenance';

export interface ImportJobData {
  providerKey: string;
  competitionExternalId?: string;
  seasonExternalId?: string;
  matchLimit?: number;
  includeEvents?: boolean;
  includeTracking?: boolean;
  since?: string;
  requestedById?: string;
  demo?: boolean;
}

export interface AnalyticsJobData {
  competitionSeasonId?: string;
  refreshMaterializedViews?: boolean;
}

export interface ExportJobData {
  dataset?: string;
  sql?: string;
  format: 'csv' | 'json' | 'sql';
  name?: string;
  requestedById?: string;
}

export interface ReportJobData {
  playerId?: string;
  teamId?: string;
  matchId?: string;
  competitionSeasonId?: string;
  title?: string;
  summary?: string;
  recommendation?: string;
  authorId?: string;
  includePdf?: boolean;
}

export interface MaintenanceJobData {
  task: 'backup' | 'cleanup' | 'refresh-views';
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

const queues = new Map<string, Queue>();

function getQueue<T>(name: string): Queue<T> {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: createRedis(),
      prefix: QUEUE_PREFIX,
      defaultJobOptions,
    });
    queues.set(name, queue);
  }
  return queue as Queue<T>;
}

export const importQueue = (): Queue<ImportJobData> => getQueue<ImportJobData>(QUEUE_IMPORT);
export const analyticsQueue = (): Queue<AnalyticsJobData> =>
  getQueue<AnalyticsJobData>(QUEUE_ANALYTICS);
export const exportQueue = (): Queue<ExportJobData> => getQueue<ExportJobData>(QUEUE_EXPORT);
export const reportQueue = (): Queue<ReportJobData> => getQueue<ReportJobData>(QUEUE_REPORT);
export const maintenanceQueue = (): Queue<MaintenanceJobData> =>
  getQueue<MaintenanceJobData>(QUEUE_MAINTENANCE);

export const ALL_QUEUES = [
  QUEUE_IMPORT,
  QUEUE_ANALYTICS,
  QUEUE_EXPORT,
  QUEUE_REPORT,
  QUEUE_MAINTENANCE,
] as const;

/** Job dashboard counts (§57). */
export async function queueCounts() {
  const result: Record<string, Record<string, number>> = {};

  for (const name of ALL_QUEUES) {
    const queue = getQueue(name);
    result[name] = await queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused',
    );
  }

  return result;
}

export async function recentJobs(name: string, limit = 25) {
  const queue = getQueue(name);
  const [waiting, active, completed, failed] = await Promise.all([
    queue.getJobs(['waiting'], 0, limit),
    queue.getJobs(['active'], 0, limit),
    queue.getJobs(['completed'], 0, limit),
    queue.getJobs(['failed'], 0, limit),
  ]);

  const describe = (state: string) => (job: Awaited<ReturnType<Queue['getJob']>>) => ({
    id: job?.id ?? null,
    name: job?.name ?? null,
    state,
    data: job?.data ?? null,
    progress: job?.progress ?? 0,
    attemptsMade: job?.attemptsMade ?? 0,
    timestamp: job?.timestamp ?? null,
    processedOn: job?.processedOn ?? null,
    finishedOn: job?.finishedOn ?? null,
    failedReason: job?.failedReason ?? null,
    returnvalue: job?.returnvalue ?? null,
    durationMs:
      job?.finishedOn && job?.processedOn ? job.finishedOn - job.processedOn : null,
  });

  return [
    ...active.map(describe('active')),
    ...waiting.map(describe('waiting')),
    ...failed.map(describe('failed')),
    ...completed.map(describe('completed')),
  ];
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
