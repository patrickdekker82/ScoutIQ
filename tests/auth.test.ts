import { describe, expect, it } from 'vitest';
import { hashPassword, issueToken, verifyPassword, verifyToken } from '../src/domain/auth.js';

const SECRET = 'a'.repeat(32);

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
    const token = issueToken({ sub: 'user-1', role: 'ADMIN' }, SECRET, 3600);
    expect(verifyToken(token, SECRET)).toMatchObject({ sub: 'user-1', role: 'ADMIN' });
  });

  it('rejects a token signed with another secret', () => {
    const token = issueToken({ sub: 'user-1', role: 'ADMIN' }, SECRET, 3600);
    expect(verifyToken(token, 'b'.repeat(32))).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = issueToken({ sub: 'user-1', role: 'VIEWER' }, SECRET, 3600);
    const forged = `${Buffer.from(JSON.stringify({ sub: 'user-1', role: 'ADMIN', exp: 9e9 })).toString('base64url')}.${token.split('.')[1]}`;
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
