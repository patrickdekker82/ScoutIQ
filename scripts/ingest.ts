import { ImportTrigger } from '@prisma/client';
import { disconnectPrisma } from '@/db/client';
import { disconnectRedis } from '@/lib/redis';
import { getStorage } from '@/lib/storage';
import { createProvider, PROVIDER_KEYS } from '@/providers';
import { ImportService } from '@/server/services/import.service';

/**
 * Import CLI (§14, §15, §16).
 *
 *   npm run ingest:statsbomb -- --competition 11 --season 90 --matches 5
 *   npm run ingest:skillcorner -- --matches 2 --tracking
 *   npm run ingest:metrica
 *   npm run ingest:demo
 *
 * The same ImportService the worker uses, so a manual import and a scheduled
 * one behave identically.
 */

const ALIASES: Record<string, string> = {
  statsbomb: 'statsbomb-open',
  skillcorner: 'skillcorner-open',
  metrica: 'metrica-sample',
  demo: 'scoutiq-demo',
  csv: 'csv-json',
};

interface Args {
  provider: string;
  competition?: string;
  season?: string;
  matches?: number;
  tracking: boolean;
  noEvents: boolean;
}

function parseArgs(argv: string[]): Args {
  const [providerArg, ...rest] = argv;
  if (!providerArg) {
    throw new Error(
      `Usage: tsx scripts/ingest.ts <provider> [options]\n` +
        `Providers: ${[...Object.keys(ALIASES), ...PROVIDER_KEYS].join(', ')}`,
    );
  }

  const args: Args = {
    provider: ALIASES[providerArg] ?? providerArg,
    tracking: false,
    noEvents: false,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];

    switch (flag) {
      case '--competition':
        args.competition = value;
        i += 1;
        break;
      case '--season':
        args.season = value;
        i += 1;
        break;
      case '--matches':
        args.matches = Number(value);
        i += 1;
        break;
      case '--tracking':
        args.tracking = true;
        break;
      case '--no-events':
        args.noEvents = true;
        break;
      default:
        break;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const provider = createProvider(args.provider);

  if (!provider.isConfigured()) {
    throw new Error(
      `Provider ${provider.key} is not configured. ` +
        `Check the ENABLE_* flag or the API key in your .env.`,
    );
  }

  await getStorage().ensureAllAreas();

  process.stdout.write(`Importing from ${provider.name} (${provider.key})\n`);
  process.stdout.write(`Licence: ${provider.licence.name}\n`);
  if (provider.licence.notes) process.stdout.write(`  ${provider.licence.notes}\n`);
  process.stdout.write('\n');

  const service = new ImportService();
  const summary = await service.run(provider, {
    ...(args.competition ? { competitionExternalId: args.competition } : {}),
    ...(args.season ? { seasonExternalId: args.season } : {}),
    ...(args.matches ? { matchLimit: args.matches } : {}),
    includeEvents: !args.noEvents,
    includeTracking: args.tracking,
    trigger: ImportTrigger.MANUAL,
    onProgress: (message, progress) => {
      process.stdout.write(`\r[${String(progress).padStart(3)}%] ${message.padEnd(60)}`);
    },
  });

  process.stdout.write('\n\n');
  process.stdout.write(
    [
      `Status:      ${summary.status}`,
      `Teams:       ${summary.teams}`,
      `Players:     ${summary.players}`,
      `Matches:     ${summary.matches}`,
      `Events:      ${summary.events}`,
      `Errors:      ${summary.errors}`,
      `Warnings:    ${summary.warnings}`,
      `Duration:    ${(summary.durationMs / 1000).toFixed(1)}s`,
      '',
      'Next: npm run analytics:refresh',
      '',
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
    await disconnectRedis();
  });
