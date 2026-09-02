import { getConfig } from '../config/env.js';
import { getStorage } from '../lib/storage.js';

/**
 * Creates the storage tree and reports what is (and is not) available.
 * Useful right after mounting a new disk, NAS share or VPS block volume.
 */
async function main(): Promise<void> {
  const storage = getStorage();
  const roots = await storage.ensureAllAreas();

  const archive = storage.archiveConfigured
    ? (await storage.archiveAvailable())
      ? `available (${getConfig().storage.archive})`
      : `configured but UNAVAILABLE (${getConfig().storage.archive}) - optional, continuing`
    : 'not configured - optional';

  for (const [area, path] of Object.entries(roots)) {
    process.stdout.write(`${area.padEnd(8)} ${path}\n`);
  }
  process.stdout.write(`archive  ${archive}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
