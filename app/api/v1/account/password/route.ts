import { z } from 'zod';
import { prisma } from '@/db/client';
import { hashPassword, verifyPassword } from '@/server/auth-core';
import { issueSessionToken, requireUser, SESSION_COOKIE } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, parseBody, route } from '@/server/http';
import { getConfig } from '@/lib/config';
import { NextResponse } from 'next/server';

const schema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

/**
 * Change your own password.
 *
 * Bumping tokenVersion signs out every other session; this response then
 * carries a fresh cookie so the caller stays signed in here.
 */
export const POST = route(async (request: Request) => {
  const session = await requireUser(request);
  const body = await parseBody(request, schema);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    return apiError(401, 'invalid_credentials', { message: 'Current password is incorrect.' });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(body.newPassword),
      tokenVersion: { increment: 1 },
    },
  });

  await audit({
    actorId: user.id,
    action: 'user.update',
    entityType: 'user',
    entityId: user.id,
    summary: 'Changed their own password',
    details: { sessionsRevoked: true },
    ip: clientIp(request),
  });

  const config = getConfig();
  const response = NextResponse.json({ ok: true, otherSessionsSignedOut: true });
  response.cookies.set(SESSION_COOKIE, issueSessionToken(updated), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.auth.tokenTtlSeconds,
  });

  return response;
});
