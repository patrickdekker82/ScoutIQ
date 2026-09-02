import { getConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { getAnalyticsQueue, getImportQueue } from './queues.js';

/**
 * Registers the repeatable jobs.
 *
 * Schedules live in Redis, not in a host crontab, so a migration to another
 * machine carries them along and there is no OS-level scheduling to recreate.
 * Set SCHEDULER_ENABLED=false to stop scheduled imports - the first step of
 * the VPS migration runbook.
 */
export async function registerSchedules(): Promise<void> {
  const { scheduler } = getConfig();

  if (!scheduler.enabled) {
    logger.warn('scheduler disabled (SCHEDULER_ENABLED=false); removing repeatable jobs');
    await removeSchedules();
    return;
  }

  await getImportQueue().upsertJobScheduler(
    'scheduled-import',
    { pattern: scheduler.importCron },
    { name: 'import-all' },
  );
  await getAnalyticsQueue().upsertJobScheduler(
    'scheduled-analytics',
    { pattern: scheduler.analyticsCron },
    { name: 'recompute-current-season' },
  );

  logger.info(
    { importCron: scheduler.importCron, analyticsCron: scheduler.analyticsCron },
    'schedules registered',
  );
}

export async function removeSchedules(): Promise<void> {
  await Promise.allSettled([
    getImportQueue().removeJobScheduler('scheduled-import'),
    getAnalyticsQueue().removeJobScheduler('scheduled-analytics'),
  ]);
}
