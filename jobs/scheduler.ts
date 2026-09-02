import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { analyticsQueue, importQueue, maintenanceQueue } from '@/jobs/queues';

/**
 * Scheduler (§58).
 *
 * Schedules live in Redis, not in a host crontab, so a migration to another
 * machine carries them along and there is no OS-level scheduling to recreate.
 * SCHEDULER_ENABLED=false removes them - the first step of a migration.
 */
export async function registerSchedules(): Promise<string[]> {
  const { scheduler } = getConfig();

  if (!scheduler.enabled) {
    logger.warn('scheduler disabled (SCHEDULER_ENABLED=false); removing repeatable jobs');
    await removeSchedules();
    return [];
  }

  await importQueue().upsertJobScheduler(
    'provider-sync',
    { pattern: scheduler.providerSyncCron },
    { name: 'scheduled-import', data: { providerKey: 'all' } },
  );

  await analyticsQueue().upsertJobScheduler(
    'analytics-refresh',
    { pattern: scheduler.analyticsCron },
    { name: 'scheduled-analytics', data: {} },
  );

  await analyticsQueue().upsertJobScheduler(
    'materialized-view-refresh',
    { pattern: scheduler.materializedViewCron },
    { name: 'refresh-views', data: { refreshMaterializedViews: true } },
  );

  await maintenanceQueue().upsertJobScheduler(
    'nightly-backup',
    { pattern: scheduler.backupCron },
    { name: 'backup', data: { task: 'backup' } },
  );

  await maintenanceQueue().upsertJobScheduler(
    'weekly-cleanup',
    { pattern: scheduler.cleanupCron },
    { name: 'cleanup', data: { task: 'cleanup' } },
  );

  const registered = [
    `provider-sync (${scheduler.providerSyncCron})`,
    `analytics-refresh (${scheduler.analyticsCron})`,
    `materialized-view-refresh (${scheduler.materializedViewCron})`,
    `nightly-backup (${scheduler.backupCron})`,
    `weekly-cleanup (${scheduler.cleanupCron})`,
  ];

  logger.info({ registered }, 'schedules registered');
  return registered;
}

export async function removeSchedules(): Promise<void> {
  await Promise.allSettled([
    importQueue().removeJobScheduler('provider-sync'),
    analyticsQueue().removeJobScheduler('analytics-refresh'),
    analyticsQueue().removeJobScheduler('materialized-view-refresh'),
    maintenanceQueue().removeJobScheduler('nightly-backup'),
    maintenanceQueue().removeJobScheduler('weekly-cleanup'),
  ]);
}

export async function listSchedules() {
  const [imports, analytics, maintenance] = await Promise.all([
    importQueue().getJobSchedulers(),
    analyticsQueue().getJobSchedulers(),
    maintenanceQueue().getJobSchedulers(),
  ]);
  return [...imports, ...analytics, ...maintenance];
}
