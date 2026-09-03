import { prisma } from '@/db/client';
import { logger } from '@/lib/logger';

/**
 * Audit log (§64).
 *
 * Records who did what: imports, provider changes, entity merges, report
 * generation, admin actions, deletions and data changes.
 *
 * Auditing must never break the action it records, so failures here are logged
 * and swallowed rather than propagated.
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'user.create'
  | 'user.update'
  | 'user.deactivate'
  | 'provider.update'
  | 'sync.schedule.create'
  | 'sync.schedule.update'
  | 'sync.schedule.delete'
  | 'sync.schedule.run'
  | 'import.start'
  | 'import.complete'
  | 'import.fail'
  | 'import.file.upload'
  | 'import.file.delete'
  | 'entity.merge'
  | 'analytics.refresh'
  | 'report.generate'
  | 'report.delete'
  | 'export.create'
  | 'sql.execute'
  | 'shortlist.update'
  | 'note.create'
  | 'rating.create'
  | 'rating.delete'
  | 'backup.run'
  | 'data.delete';

export interface AuditEntry {
  actorId?: string | null;
  action: AuditAction;
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        details: (entry.details ?? {}) as object,
        ip: entry.ip ?? null,
      },
    });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), action: entry.action },
      'failed to write audit log',
    );
  }
}

/** Client IP from the proxy headers, for audit entries. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}
