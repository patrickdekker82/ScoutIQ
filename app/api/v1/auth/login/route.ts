import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { getConfig } from '@/lib/config';
import { verifyPassword } from '@/server/auth-core';
import { issueSessionToken, SESSION_COOKIE } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { loginRateLimit } from '@/server/rate-limit';
import { apiError, parseBody, route } from '@/server/http';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = route(async (request: Request) => {
  const { email, password } = await parseBody(request, schema);
  const ip = clientIp(request);

  // Rate limited per email AND per address (§62).
  const limit = await loginRateLimit(`${email}:${ip ?? 'unknown'}`);
  if (!limit.allowed) {
    return apiError(429, 'too_many_requests', {
      message: `Too many login attempts. Try again in ${limit.resetSeconds}s.`,
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user?.active === true && (await verifyPassword(password, user.passwordHash));

  if (!user || !valid) {
    await audit({
      action: 'auth.login_failed',
      summary: `Failed login for ${email}`,
      ip,
      details: { email },
    });
    // Deliberately identical for unknown user and wrong password.
    return apiError(401, 'invalid_credentials');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({
    actorId: user.id,
    action: 'auth.login',
    summary: `${user.displayName} signed in`,
    ip,
  });

  const config = getConfig();
  const token = issueSessionToken(user);

  const response = NextResponse.json({
    token,
    expiresIn: config.auth.tokenTtlSeconds,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.auth.tokenTtlSeconds,
  });

  return response;
});
