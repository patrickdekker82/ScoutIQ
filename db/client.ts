import { PrismaClient } from '@prisma/client';
import { getConfig } from '@/lib/config';

/**
 * Prisma client bound to DATABASE_URL.
 *
 * The URL is injected rather than baked into the schema so the same image can
 * talk to the compose-managed PostgreSQL, a database on another host, or a
 * managed instance without a rebuild.
 *
 * In development the client is cached on globalThis so Next.js hot reloads do
 * not exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { scoutiqPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.scoutiqPrisma) {
    const config = getConfig();
    globalForPrisma.scoutiqPrisma = new PrismaClient({
      datasources: { db: { url: config.database.url } },
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }
  return globalForPrisma.scoutiqPrisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    return Reflect.get(getPrisma(), property);
  },
});

export async function disconnectPrisma(): Promise<void> {
  await globalForPrisma.scoutiqPrisma?.$disconnect();
  globalForPrisma.scoutiqPrisma = undefined;
}
