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

  // Per-provider external API synchronisation (§88 phase 8). Each database
  // schedule gets its own repeatable job so a season on an hourly cadence does
  // not drag every other season along with it.
  const syncSchedules = await listSyncSchedules();
  for (const schedule of syncSchedules) {
    await importQueue().upsertJobScheduler(
      `external-sync-${schedule.id}`,
      { pattern: schedule.cron },
      { name: 'external-sync', data: { providerKey: schedule.providerKey, syncScheduleId: schedule.id } },
    );
  }

  // Any repeatable job left over from a schedule that has since been deleted or
  // disabled is removed, so Redis never outlives the database.
  const wanted = new Set(syncSchedules.map((schedule) => `external-sync-${schedule.id}`));
  for (const existing of await importQueue().getJobSchedulers()) {
    if (existing.key?.startsWith('external-sync-') && !wanted.has(existing.key)) {
      await importQueue().removeJobScheduler(existing.key);
    }
  }

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
    ...syncSchedules.map((schedule) => `external-sync ${schedule.name} (${schedule.cron})`),
    `analytics-refresh (${scheduler.analyticsCron})`,
    `materialized-view-refresh (${scheduler.materializedViewCron})`,
    `nightly-backup (${scheduler.backupCron})`,
    `weekly-cleanup (${scheduler.cleanupCron})`,
  ];

  logger.info({ registered }, 'schedules registered');
  return registered;
}

/**
 * Sync schedules as the scheduler needs them.
 *
 * Read lazily so `registerSchedules` still works against a database that has
 * not been migrated yet - a fresh checkout runs the scheduler before the first
 * schedule exists.
 */
async function listSyncSchedules(): Promise<
  { id: string; name: string; cron: string; providerKey: string }[]
> {
  try {
    const { prisma } = await import('@/db/client');
    const rows = await prisma.providerSyncSchedule.findMany({
      where: { enabled: true, provider: { enabled: true } },
      select: { id: true, name: true, cron: true, provider: { select: { key: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cron: row.cron,
      providerKey: row.provider.key,
    }));
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'could not read sync schedules; external synchronisation not registered',
    );
    return [];
  }
}

export async function removeSchedules(): Promise<void> {
  const external = (await importQueue().getJobSchedulers())
    .map((entry) => entry.key)
    .filter((key): key is string => Boolean(key?.startsWith('external-sync-')));

  await Promise.allSettled([
    ...external.map((key) => importQueue().removeJobScheduler(key)),
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
