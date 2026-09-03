import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The installation guide (docs/INSTALLATIE.md) is the one document a person
 * follows literally at a keyboard, so its commands are checked against the
 * code they call. A guide that drifts is worse than no guide.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const read = (file: string): Promise<string> =>
  readFile(path.join(REPO_ROOT, file), 'utf8');

describe('docs/INSTALLATIE.md', () => {
  it('only names container roles the entrypoint actually accepts', async () => {
    const [guide, entrypoint] = await Promise.all([
      read('docs/INSTALLATIE.md'),
      read('scripts/docker-entrypoint.sh'),
    ]);

    const roles = [...guide.matchAll(/docker compose run --rm[^\n]*?\bweb (\w+)/g)].map(
      (match) => match[1] as string,
    );

    expect(roles.length).toBeGreaterThan(0);
    for (const role of new Set(roles)) {
      if (role === 'npx') continue; // `web npx tsx ...` falls through to the verbatim branch
      expect(entrypoint, `entrypoint has no "${role}" role`).toContain(`  ${role})`);
    }
  });

  it('names provider aliases the ingest script understands', async () => {
    const [guide, ingest] = await Promise.all([
      read('docs/INSTALLATIE.md'),
      read('scripts/ingest.ts'),
    ]);

    const providers = [...guide.matchAll(/scripts\/ingest\.ts (\S+)/g)].map(
      (match) => match[1] as string,
    );

    for (const provider of new Set(providers)) {
      expect(ingest, `ingest.ts does not know "${provider}"`).toMatch(
        new RegExp(`(${provider}:|'${provider}')`),
      );
    }
  });

  it('references environment variables that exist in .env.example', async () => {
    const [guide, example] = await Promise.all([
      read('docs/INSTALLATIE.md'),
      read('.env.example'),
    ]);

    for (const key of [
      'AUTH_SECRET',
      'POSTGRES_PASSWORD',
      'SPORTMONKS_API_KEY',
      'API_FOOTBALL_KEY',
      'NAS_BACKUP_PATH',
      'PORT',
    ]) {
      expect(guide, `the guide should mention ${key}`).toContain(key);
      expect(example, `.env.example is missing ${key}`).toContain(`${key}=`);
    }
  });

  it('links only to documents that exist', async () => {
    const guide = await read('docs/INSTALLATIE.md');
    const links = [...guide.matchAll(/\]\((?!http)([^)#]+)\)/g)].map(
      (match) => match[1] as string,
    );

    expect(links.length).toBeGreaterThan(5);
    for (const link of new Set(links)) {
      await expect(
        read(path.join('docs', link)),
        `docs/INSTALLATIE.md links to a missing ${link}`,
      ).resolves.toBeTypeOf('string');
    }
  });

  it('still tells the reader there is no default password', async () => {
    const guide = await read('docs/INSTALLATIE.md');

    expect(guide).toMatch(/zonder\*{0,2} standaardwachtwoord/i);
    expect(guide).toContain('SEED_ADMIN_PASSWORD');
  });

  it('keeps the safety rules that §62 and §13 require', async () => {
    const guide = await read('docs/INSTALLATIE.md');

    // Never expose the database, never put the live data directory on a share,
    // never assume open data is commercially licensed.
    expect(guide).toMatch(/PostgreSQL, Redis of pgAdmin rechtstreeks aan het internet/i);
    expect(guide).toMatch(/SMB\/NFS|netwerkschijf/i);
    expect(guide).toMatch(/commercieel gebruikt mag worden|Provider registry/i);
  });
});
