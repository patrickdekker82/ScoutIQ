import { NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/server/auth';
import { audit } from '@/server/audit';
import { route } from '@/server/http';

export const POST = route(async (request: Request) => {
  const user = await getSessionUser(request);
  if (user) {
    await audit({ actorId: user.id, action: 'auth.logout', summary: `${user.displayName} signed out` });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return response;
});
