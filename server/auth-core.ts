import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Self-hosted authentication.
 *
 * Passwords are hashed with scrypt and sessions are stateless HMAC tokens, so
 * ScoutIQ needs no external identity provider. An external provider can be put
 * in front later (reverse proxy / OIDC) without changing the data model.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface TokenPayload {
  sub: string;
  role: string;
  /** User token version; bumping it on the user revokes every session. */
  ver?: number;
  exp: number;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

const sign = (data: string, secret: string): string =>
  createHmac('sha256', secret).update(data).digest('base64url');

export function issueToken(
  payload: Omit<TokenPayload, 'exp'>,
  secret: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const body: TokenPayload = {
    ...payload,
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const encoded = base64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenPayload | null {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
