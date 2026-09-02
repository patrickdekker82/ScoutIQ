import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { hashPassword } from '@/server/auth-core';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, parseBody, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  role: z.nativeEnum(UserRole).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

/**
 * Update a user (§63).
 *
 * Changing a password or deactivating an account bumps `tokenVersion`, which
 * revokes every session that account already had - otherwise "deactivated"
 * would mean "deactivated once their token expires".
 */
export const PATCH = route(async (request: Request, context: Context) => {
  const admin = await requirePermission('users:manage', request);
  const { id } = await context.params;
  const body = await parseBody(request, patchSchema);

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) return apiError(404, 'not_found');

  // An admin must not lock the last door behind themselves.
  if ((body.active === false || (body.role && body.role !== 'ADMIN')) && target.role === 'ADMIN') {
    const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    if (admins <= 1) {
      return apiError(409, 'conflict', {
        message: 'This is the only active admin. Promote another account first.',
      });
    }
  }

  const revokes = body.password !== undefined || body.active === false;

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      ...(revokes ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: { id: true, email: true, displayName: true, role: true, active: true },
  });

  const changes = Object.keys(body).filter((key) => key !== 'password');
  if (body.password) changes.push('password');

  await audit({
    actorId: admin.id,
    action: body.active === false ? 'user.deactivate' : 'user.update',
    entityType: 'user',
    entityId: user.id,
    summary: `Updated ${user.email} (${changes.join(', ') || 'no change'})`,
    details: { changes, sessionsRevoked: revokes },
    ip: clientIp(request),
  });

  return json(user);
});
