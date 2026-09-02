import { ImportStatus, type PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@/lib/config';
import { MAX_CONSECUTIVE_FAILURES, SyncService } from '@/server/services/sync.service';
import type { ImportService, ImportSummary } from '@/server/services/import.service';

/**
 * External API synchronisation (§88 phase 8).
 *
 * Exercised against a stub client: what matters here is the state machine -
 * when the watermark moves, when a run is skipped rather than failed, and when
 * a repeatedly failing schedule takes itself out of the rotation.
 */

const SCHEDULE_ID = '33333333-3333-3333-3333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-4444-444444444444';

interface Row {
  id: string;
  providerId: string;
  name: string;
  cron: string;
  enabled: boolean;
  competitionExternalId: string | null;
  seasonExternalId: string | null;
  includeEvents: boolean;
  includeTracking: boolean;
  matchLimit: number | null;
  overlapHours: number;
  watermark: Date | null;
  lastRunAt: Date | null;
  lastStatus: ImportStatus | null;
  lastError: string | null;
  consecutiveFailures: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const baseRow = (overrides: Partial<Row> = {}): Row => ({
  id: SCHEDULE_ID,
  providerId: PROVIDER_ID,
  name: 'Eredivisie 2025/26',
  cron: '0 4 * * *',
  enabled: true,
  competitionExternalId: '88',
  seasonExternalId: '2025',
  includeEvents: true,
  includeTracking: false,
  matchLimit: null,
  overlapHours: 24,
  watermark: null,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  consecutiveFailures: 0,
  createdById: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const summary = (status: ImportStatus): ImportSummary => ({
  importId: 'import-1',
  status,
  competitions: 1,
  seasons: 1,
  teams: 18,
  players: 400,
  matches: 3,
  events: 9000,
  trackingFrames: 0,
  errors: status === ImportStatus.COMPLETED ? 0 : 2,
  warnings: 0,
  durationMs: 1234,
});

interface Harness {
  prisma: PrismaClient;
  row: Row;
  updates: Record<string, unknown>[];
  runCalls: { since: Date | undefined }[];
}

function harness(options: {
  row?: Partial<Row>;
  providerEnabled?: boolean;
  newestKickoff?: Date | null;
  run?: (options: { since?: Date }) => Promise<ImportSummary>;
}): Harness {
  const row = baseRow(options.row);
  const updates: Record<string, unknown>[] = [];
  const runCalls: { since: Date | undefined }[] = [];

  const prisma = {
    providerSyncSchedule: {
      findUnique: async () => ({
        ...row,
        provider: { key: 'sportmonks', enabled: options.providerEnabled ?? true },
      }),
      findMany: async () => [{ id: row.id }],
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        const increment = (data.consecutiveFailures as { increment?: number } | undefined)
          ?.increment;
        if (increment) row.consecutiveFailures += increment;
        return { ...row };
      },
    },
    externalEntityMapping: {
      findUnique: async () => ({ internalId: 'season-internal-id' }),
    },
    match: {
      findFirst: async () =>
        options.newestKickoff === null ? null : { kickoffAt: options.newestKickoff },
    },
  } as unknown as PrismaClient;

  const imports = {
    run: async (_provider: unknown, runOptions: { since?: Date }) => {
      runCalls.push({ since: runOptions.since });
      return options.run
        ? await options.run(runOptions)
        : summary(ImportStatus.COMPLETED);
    },
  } as unknown as ImportService;

  const service = new SyncService(prisma, imports);
  return Object.assign({ prisma, row, updates, runCalls }, { service }) as Harness & {
    service: SyncService;
  };
}

beforeEach(() => {
  // Sportmonks must look configured for the happy paths. The config is cached,
  // so it has to be rebuilt after the environment changes.
  process.env.SPORTMONKS_API_KEY = 'test-key';
  resetConfig();
});

afterAll(() => {
  delete process.env.SPORTMONKS_API_KEY;
  resetConfig();
});

describe('windowStart', () => {
  it('is null before the first successful run, so the first sync is a full one', () => {
    const service = new SyncService();
    expect(service.windowStart({ watermark: null, overlapHours: 24 })).toBeNull();
  });

  it('rewinds by the overlap window so a corrected fixture is not missed', () => {
    const service = new SyncService();
    const start = service.windowStart({
      watermark: new Date('2026-03-10T12:00:00Z'),
      overlapHours: 24,
    });
    expect(start?.toISOString()).toBe('2026-03-09T12:00:00.000Z');
  });

  it('reads back exactly the watermark when no overlap is configured', () => {
    const service = new SyncService();
    const start = service.windowStart({
      watermark: new Date('2026-03-10T12:00:00Z'),
      overlapHours: 0,
    });
    expect(start?.toISOString()).toBe('2026-03-10T12:00:00.000Z');
  });
});

describe('runSchedule', () => {
  it('passes the rewound window to the importer', async () => {
    const { service, runCalls } = harness({
      row: { watermark: new Date('2026-03-10T12:00:00Z'), overlapHours: 6 },
      newestKickoff: new Date('2026-03-14T18:00:00Z'),
    }) as Harness & { service: SyncService };

    await service.runSchedule(SCHEDULE_ID);

    expect(runCalls[0]?.since?.toISOString()).toBe('2026-03-10T06:00:00.000Z');
  });

  it('advances the watermark to the newest kickoff actually stored', async () => {
    const { service, updates } = harness({
      newestKickoff: new Date('2026-03-14T18:00:00Z'),
    }) as Harness & { service: SyncService };

    const result = await service.runSchedule(SCHEDULE_ID);

    expect(result.status).toBe(ImportStatus.COMPLETED);
    expect((updates[0]?.watermark as Date).toISOString()).toBe('2026-03-14T18:00:00.000Z');
    expect(updates[0]?.consecutiveFailures).toBe(0);
  });

  it('leaves the watermark alone after a partial import, so no hole is created', async () => {
    const { service, updates } = harness({
      newestKickoff: new Date('2026-03-14T18:00:00Z'),
      run: async () => summary(ImportStatus.FAILED),
    }) as Harness & { service: SyncService };

    await service.runSchedule(SCHEDULE_ID);

    expect(updates[0]).not.toHaveProperty('watermark');
  });

  it('skips - does not fail - a provider with no API key', async () => {
    delete process.env.SPORTMONKS_API_KEY;
    resetConfig();
    const { service, runCalls } = harness({}) as Harness & { service: SyncService };

    const result = await service.runSchedule(SCHEDULE_ID);

    expect(result.status).toBe(ImportStatus.CANCELLED);
    expect(result.skippedReason).toContain('no API key');
    expect(runCalls).toHaveLength(0);
  });

  it('skips a schedule whose provider has been disabled', async () => {
    const { service, runCalls } = harness({ providerEnabled: false }) as Harness & {
      service: SyncService;
    };

    const result = await service.runSchedule(SCHEDULE_ID);

    expect(result.status).toBe(ImportStatus.CANCELLED);
    expect(result.skippedReason).toBe('provider disabled');
    expect(runCalls).toHaveLength(0);
  });

  it('records the error instead of throwing it at the worker', async () => {
    const { service, updates } = harness({
      run: async () => {
        throw new Error('402 Payment Required');
      },
    }) as Harness & { service: SyncService };

    const result = await service.runSchedule(SCHEDULE_ID);

    expect(result.status).toBe(ImportStatus.FAILED);
    expect(result.error).toContain('402');
    expect(updates[0]?.lastError).toContain('402');
    expect(updates[0]?.consecutiveFailures).toEqual({ increment: 1 });
  });

  it('disables itself rather than hammering a paid API forever', async () => {
    const { service, updates } = harness({
      row: { consecutiveFailures: MAX_CONSECUTIVE_FAILURES - 1 },
      run: async () => {
        throw new Error('401 Unauthorized');
      },
    }) as Harness & { service: SyncService };

    await service.runSchedule(SCHEDULE_ID);

    expect(updates.at(-1)).toEqual({ enabled: false });
  });
});
