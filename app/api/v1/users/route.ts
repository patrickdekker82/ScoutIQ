import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { hashPassword } from '@/server/auth-core';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, parseBody, route } from '@/server/http';

/** User administration (§63). Admin only. */
export const GET = route(async (request: Request) => {
  await requirePermission('users:manage', request);

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      active: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { reports: true, notes: true, shortlists: true } },
    },
    orderBy: [{ active: 'desc' }, { displayName: 'asc' }],
  });

  return json(users);
});

const createSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  role: z.nativeEnum(UserRole),
  password: z.string().min(8).max(200),
});

export const POST = route(async (request: Request) => {
  const admin = await requirePermission('users:manage', request);
  const body = await parseBody(request, createSchema);

  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) {
    return apiError(409, 'conflict', { message: 'That email address already has an account.' });
  }

  const user = await prisma.user.create({
    data: {
      email: body.email,
      displayName: body.displayName,
      role: body.role,
      passwordHash: await hashPassword(body.password),
    },
    select: { id: true, email: true, displayName: true, role: true, active: true },
  });

  await audit({
    actorId: admin.id,
    action: 'user.create',
    entityType: 'user',
    entityId: user.id,
    summary: `Created ${user.role.toLowerCase()} account for ${user.email}`,
    ip: clientIp(request),
  });

  return json(user, { status: 201 });
});
