import { describe, expect, it } from 'vitest';
import { hashPassword, issueToken, verifyPassword, verifyToken } from '@/server/auth-core';
import { can, PERMISSIONS } from '@/server/auth';

const SECRET = 'a'.repeat(32);

/** Authentication and role-based access (§62, §63). */
describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('refuses trivially short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least 8/);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a payload', () => {
    const token = issueToken({ sub: 'user-1', role: 'ADMIN', ver: 0 }, SECRET, 3600);
    expect(verifyToken(token, SECRET)).toMatchObject({ sub: 'user-1', role: 'ADMIN', ver: 0 });
  });

  it('rejects a token signed with another secret', () => {
    const token = issueToken({ sub: 'user-1', role: 'ADMIN' }, SECRET, 3600);
    expect(verifyToken(token, 'b'.repeat(32))).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = issueToken({ sub: 'user-1', role: 'VIEWER' }, SECRET, 3600);
    const forged = `${Buffer.from(
      JSON.stringify({ sub: 'user-1', role: 'ADMIN', exp: 9e9 }),
    ).toString('base64url')}.${token.split('.')[1]}`;
    expect(verifyToken(forged, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const issuedAt = Date.now();
    const token = issueToken({ sub: 'user-1', role: 'SCOUT' }, SECRET, 60, issuedAt);
    expect(verifyToken(token, SECRET, issuedAt + 61_000)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyToken('nonsense', SECRET)).toBeNull();
    expect(verifyToken('', SECRET)).toBeNull();
  });
});

describe('role permissions', () => {
  it('gives admin everything', () => {
    for (const permission of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can('ADMIN', permission)).toBe(true);
    }
  });

  it('keeps SQL and exports to analysts and admins (§63)', () => {
    expect(can('ANALYST', 'sql:read')).toBe(true);
    expect(can('SCOUT', 'sql:read')).toBe(false);
    expect(can('VIEWER', 'sql:read')).toBe(false);
    expect(can('ANALYST', 'exports:create')).toBe(true);
    expect(can('SCOUT', 'exports:create')).toBe(false);
  });

  it('lets scouts write notes and shortlists but not run imports', () => {
    expect(can('SCOUT', 'notes:write')).toBe(true);
    expect(can('SCOUT', 'shortlists:write')).toBe(true);
    expect(can('SCOUT', 'reports:create')).toBe(true);
    expect(can('SCOUT', 'imports:run')).toBe(false);
    expect(can('ANALYST', 'users:manage')).toBe(false);
  });

  it('makes a viewer read-only', () => {
    expect(can('VIEWER', 'data:read')).toBe(true);
    expect(can('VIEWER', 'notes:write')).toBe(false);
    expect(can('VIEWER', 'reports:create')).toBe(false);
  });
});
