import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ANALYTICS_VERSION, REPORT_VERSION } from '@/analytics/version';

/**
 * Report data snapshots (§52, §86).
 *
 * When a report is generated, the data it used is FROZEN into the version row.
 * Re-rendering that version later reproduces the same document even if the
 * underlying analytics have since been recomputed with new formulas.
 */

export interface ProviderAttribution {
  key: string;
  name: string;
  version: string;
  licenceName: string | null;
  attributionRequired: boolean;
}

export interface SnapshotMeta {
  dataSnapshotId: string;
  analyticsVersion: string;
  reportVersion: string;
  generatedAt: string;
  providerVersions: ProviderAttribution[];
}

/**
 * A content-addressed id for the frozen payload: the same data produces the
 * same snapshot id, so two reports built from identical data are provably
 * identical.
 */
export function snapshotId(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

/** Provider attribution for the Data Sources block (§13, §50). */
export async function collectProviders(prisma: PrismaClient): Promise<ProviderAttribution[]> {
  const providers = await prisma.provider.findMany({
    where: { imports: { some: {} } },
    include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  return providers.map((provider) => ({
    key: provider.key,
    name: provider.name,
    version: provider.versions[0]?.version ?? 'unknown',
    licenceName: provider.licenseName,
    attributionRequired: provider.attributionRequired,
  }));
}

export function buildSnapshotMeta(
  payload: unknown,
  providers: ProviderAttribution[],
): SnapshotMeta {
  return {
    dataSnapshotId: snapshotId(payload),
    analyticsVersion: ANALYTICS_VERSION,
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    providerVersions: providers,
  };
}
