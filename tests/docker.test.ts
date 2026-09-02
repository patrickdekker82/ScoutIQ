import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Container contract checks.
 *
 * A Docker build is the only way to be certain an image works, but most build
 * failures are boring and mechanical: a COPY of a path that no longer exists, a
 * stage that was renamed, an entrypoint role pointing at a deleted file, or a
 * runtime dependency left in devDependencies. Those are all checkable here, in
 * CI and locally, without a daemon.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (file: string): Promise<string> =>
  readFile(path.join(REPO_ROOT, file), 'utf8');

const exists = async (relative: string): Promise<boolean> => {
  try {
    await stat(path.join(REPO_ROOT, relative));
    return true;
  } catch {
    return false;
  }
};

describe('Dockerfile', () => {
  it('copies only paths that exist in the repository', async () => {
    const dockerfile = await read('Dockerfile');

    const sources = [...dockerfile.matchAll(/^COPY\s+(?!--from)(.+)$/gm)]
      .flatMap((match) => (match[1] as string).trim().split(/\s+/).slice(0, -1))
      .filter((source) => !source.startsWith('--'));

    const missing: string[] = [];
    for (const source of sources) {
      if (!(await exists(source))) missing.push(source);
    }

    expect(missing, `Dockerfile COPY sources missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('only copies from stages it actually defines', async () => {
    const dockerfile = await read('Dockerfile');

    const stages = new Set(
      [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)].map((match) =>
        (match[1] as string).toLowerCase(),
      ),
    );
    const referenced = [...dockerfile.matchAll(/COPY\s+--from=(\S+)/g)].map((match) =>
      (match[1] as string).toLowerCase(),
    );

    for (const stage of referenced) {
      expect(stages, `COPY --from=${stage} has no matching stage`).toContain(stage);
    }
  });

  it('runs as a non-root user and declares a health check (§71)', async () => {
    const dockerfile = await read('Dockerfile');
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK/m);
    // The liveness probe must not touch the database.
    expect(dockerfile).toContain('probe=live');
  });

  it('installs the PostgreSQL client the backup scripts need (§68)', async () => {
    const dockerfile = await read('Dockerfile');
    expect(dockerfile).toContain('postgresql-client');
  });
});

describe('docker entrypoint', () => {
  it('every role points at a file that exists', async () => {
    const entrypoint = await read('scripts/docker-entrypoint.sh');

    const targets = [
      // `node server.js` is produced by the standalone build, not the repo.
      { role: 'worker', file: 'jobs/worker-main.ts' },
      { role: 'scheduler', file: 'jobs/scheduler-main.ts' },
      { role: 'seed', file: 'scripts/seed.ts' },
      { role: 'demo', file: 'scripts/ingest.ts' },
      { role: 'analytics', file: 'scripts/analytics-refresh.ts' },
      { role: 'backup', file: 'scripts/db-backup.sh' },
    ];

    for (const target of targets) {
      expect(entrypoint, `role ${target.role} missing`).toContain(target.role);
      expect(await exists(target.file), `${target.file} does not exist`).toBe(true);
    }
  });

  it('waits for the database before the roles that need it', async () => {
    const entrypoint = await read('scripts/docker-entrypoint.sh');
    // backup talks to PostgreSQL through pg_dump and handles its own failure.
    for (const role of ['web', 'worker', 'scheduler', 'migrate', 'seed']) {
      const section = entrypoint.slice(entrypoint.indexOf(`  ${role})`));
      expect(section.slice(0, 200), `${role} does not wait for the database`).toContain(
        'wait_for_db',
      );
    }
  });
});

describe('runtime dependencies', () => {
  it('keeps everything the container roles execute out of devDependencies', async () => {
    const pkg = JSON.parse(await read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    // `npm ci --omit=dev` runs in the production stage, so anything the
    // entrypoint invokes at run time must be a real dependency.
    for (const name of ['next', 'react', 'react-dom', '@prisma/client', 'prisma', 'tsx', 'pg']) {
      expect(pkg.dependencies[name], `${name} must be a runtime dependency`).toBeTruthy();
      expect(pkg.devDependencies[name]).toBeUndefined();
    }
  });

  it('builds a standalone server, which is what the web role runs', async () => {
    const config = await read('next.config.ts');
    expect(config).toContain("output: 'standalone'");
    expect(await read('scripts/docker-entrypoint.sh')).toContain('node server.js');
  });
});

describe('compose stack', () => {
  it('defines the services §6 requires, with pgAdmin behind a profile', async () => {
    const compose = await read('docker-compose.yml');

    for (const service of ['postgres:', 'redis:', 'web:', 'worker:', 'scheduler:', 'migrate:']) {
      expect(compose).toContain(`  ${service}`);
    }
    expect(compose).toContain('profiles: ["admin"]');
    expect(compose).toContain('dpage/pgadmin4');
  });

  it('runs exactly one scheduler, because schedules register once', async () => {
    const prod = await read('docker-compose.prod.yml');
    const scheduler = prod.slice(prod.indexOf('  scheduler:'));
    expect(scheduler).toMatch(/replicas:\s*1/);
  });

  it('restarts services and never publishes the database by default (§8, §72)', async () => {
    const compose = await read('docker-compose.yml');
    expect((compose.match(/restart: unless-stopped/g) ?? []).length).toBeGreaterThanOrEqual(4);

    // Only the dev override may publish PostgreSQL and Redis.
    const postgres = compose.slice(compose.indexOf('  postgres:'), compose.indexOf('  redis:'));
    expect(postgres).not.toContain('ports:');
  });
});
