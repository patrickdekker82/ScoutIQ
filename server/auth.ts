import { cookies } from 'next/headers';
import { UserRole } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { prisma } from '@/db/client';
import { issueToken, verifyToken, type TokenPayload } from '@/server/auth-core';

/**
 * Session handling and role-based access control (§62, §63).
 *
 * Sessions are stateless HMAC tokens carried in an httpOnly cookie (browser)
 * or a bearer header (API clients). No external identity provider is required,
 * which keeps ScoutIQ fully self-hosted; putting OIDC in front of it later is
 * a reverse-proxy concern, not a code change.
 *
 * `tokenVersion` on the user allows revoking every session for an account.
 */

export const SESSION_COOKIE = 'scoutiq_session';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

/** Role capability matrix of §63. Admin implies everything. */
export const PERMISSIONS = {
  'providers:manage': [UserRole.ADMIN],
  'imports:run': [UserRole.ADMIN],
  'users:manage': [UserRole.ADMIN],
  'settings:manage': [UserRole.ADMIN],
  'backup:run': [UserRole.ADMIN],
  'analytics:run': [UserRole.ADMIN, UserRole.ANALYST],
  'sql:read': [UserRole.ADMIN, UserRole.ANALYST],
  'exports:create': [UserRole.ADMIN, UserRole.ANALYST],
  'reports:create': [UserRole.ADMIN, UserRole.ANALYST, UserRole.SCOUT],
  'shortlists:write': [UserRole.ADMIN, UserRole.ANALYST, UserRole.SCOUT],
  'notes:write': [UserRole.ADMIN, UserRole.ANALYST, UserRole.SCOUT],
  'data:read': [UserRole.ADMIN, UserRole.ANALYST, UserRole.SCOUT, UserRole.VIEWER],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: UserRole, permission: Permission): boolean =>
  (PERMISSIONS[permission] as readonly UserRole[]).includes(role);

export function issueSessionToken(user: {
  id: string;
  role: UserRole;
  tokenVersion: number;
}): string {
  const { auth } = getConfig();
  return issueToken(
    { sub: user.id, role: user.role, ver: user.tokenVersion },
    auth.secret,
    auth.tokenTtlSeconds,
  );
}

function decode(token: string | undefined | null): TokenPayload | null {
  if (!token) return null;
  return verifyToken(token, getConfig().auth.secret);
}

/**
 * Resolve the caller from a request.
 *
 * The database is consulted on every call so a deactivated account, a changed
 * role, or a revoked session takes effect immediately rather than at token
 * expiry.
 */
export async function getSessionUser(request?: Request): Promise<SessionUser | null> {
  let token: string | null = null;

  const header = request?.headers.get('authorization');
  if (header?.startsWith('Bearer ')) token = header.slice(7);

  if (!token) {
    const store = await cookies();
    token = store.get(SESSION_COOKIE)?.value ?? null;
  }

  const payload = decode(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, displayName: true, role: true, active: true, tokenVersion: true },
  });

  if (!user || !user.active) return null;
  if (typeof payload.ver === 'number' && payload.ver !== user.tokenVersion) return null;

  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Throwing guards for route handlers. */
export async function requireUser(request?: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw new AuthError('Authentication required', 401);
  return user;
}

export async function requirePermission(
  permission: Permission,
  request?: Request,
): Promise<SessionUser> {
  const user = await requireUser(request);
  if (!can(user.role, permission)) {
    throw new AuthError(`Role ${user.role} may not ${permission}`, 403);
  }
  return user;
}
