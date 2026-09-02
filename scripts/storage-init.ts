import { getConfig } from '@/lib/config';
import { getStorage } from '@/lib/storage';

/**
 * Create the storage tree and report what is (and is not) available.
 * Useful right after mounting a new disk, NAS share or VPS block volume.
 */
async function main(): Promise<void> {
  const storage = getStorage();
  const roots = await storage.ensureAllAreas();
  const archives = await storage.archiveStatus();

  process.stdout.write('Storage roots\n');
  for (const [area, path] of Object.entries(roots)) {
    process.stdout.write(`  ${area.padEnd(11)} ${path}\n`);
  }

  process.stdout.write('\nArchive targets (optional - NAS, object storage)\n');
  for (const [area, status] of Object.entries(archives)) {
    const target = storage.archiveTarget(area as keyof typeof archives) ?? '-';
    process.stdout.write(`  ${area.padEnd(11)} ${status.padEnd(16)} ${target}\n`);
  }

  const config = getConfig();
  if (!storage.archiveConfigured()) {
    process.stdout.write(
      '\nNo archive target configured. ScoutIQ works fully without one;\n' +
        'set NAS_BACKUP_PATH / NAS_DATASET_PATH / NAS_REPORT_PATH or ARCHIVE_ROOT to enable copies.\n',
    );
  }

  process.stdout.write(`\nDemo mode: ${config.demoMode ? 'on' : 'off'}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
