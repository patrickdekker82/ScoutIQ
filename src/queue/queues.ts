import { Queue, type JobsOptions } from 'bullmq';
import { createRedis } from '../lib/redis.js';

/**
 * Queue definitions.
 *
 * Producers (the API) and consumers (workers) only share Redis, which means
 * they can live in the same container today and on separate machines later
 * without a code change.
 */
// Names carry no colon (BullMQ reserves it as its key separator); the shared
// key prefix below namespaces them inside Redis instead, so ScoutIQ can share
// a Redis instance with other applications.
export const QUEUE_PREFIX = 'scoutiq';
export const QUEUE_IMPORT = 'import';
export const QUEUE_ANALYTICS = 'analytics';

export interface ImportJobData {
  providerKey?: string;
  since?: string;
}

export interface AnalyticsJobData {
  season?: string;
}

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

let importQueue: Queue<ImportJobData> | undefined;
let analyticsQueue: Queue<AnalyticsJobData> | undefined;

export function getImportQueue(): Queue<ImportJobData> {
  importQueue ??= new Queue<ImportJobData>(QUEUE_IMPORT, {
    connection: createRedis(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions,
  });
  return importQueue;
}

export function getAnalyticsQueue(): Queue<AnalyticsJobData> {
  analyticsQueue ??= new Queue<AnalyticsJobData>(QUEUE_ANALYTICS, {
    connection: createRedis(),
    prefix: QUEUE_PREFIX,
    defaultJobOptions,
  });
  return analyticsQueue;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([importQueue?.close(), analyticsQueue?.close()]);
  importQueue = undefined;
  analyticsQueue = undefined;
}
