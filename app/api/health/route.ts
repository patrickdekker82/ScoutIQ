import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { prisma } from '@/db/client';
import { getRedis } from '@/lib/redis';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Health endpoint (§71).
 *
 * `?probe=live` is the container health check: it must not touch the database.
 * The full check reports dependencies; the optional NAS archive is reported
 * but never fails the check (§18).
 */
export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get('probe');

  if (probe === 'live') {
    return NextResponse.json({ status: 'ok', uptime: process.uptime() });
  }

  const storage = getStorage();
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (error) {
    checks.database = error instanceof Error ? error.message : 'unreachable';
  }

  try {
    checks.redis = (await getRedis().ping()) === 'PONG' ? 'ok' : 'unexpected reply';
  } catch (error) {
    checks.redis = error instanceof Error ? error.message : 'unreachable';
  }

  try {
    await storage.ensureAllAreas();
    checks.storage = 'ok';
  } catch (error) {
    checks.storage = error instanceof Error ? error.message : 'unwritable';
  }

  const archive = await storage.archiveStatus();
  const healthy = [checks.database, checks.redis, checks.storage].every((value) => value === 'ok');

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      // Optional infrastructure: reported, never fatal.
      archive,
      storageRoots: getConfig().storage,
      demoMode: getConfig().demoMode,
    },
    { status: healthy ? 200 : 503 },
  );
}
