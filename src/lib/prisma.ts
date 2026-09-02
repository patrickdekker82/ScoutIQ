import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config/env.js';

/**
 * Prisma client bound to the configured DATABASE_URL.
 *
 * The URL is injected rather than read from a schema default so that the same
 * image can talk to a compose-managed PostgreSQL, a database on another host,
 * or a managed instance without a rebuild.
 */
let client: PrismaClient | undefined;

export function getPrisma(url?: string): PrismaClient {
  if (!client) {
    const config = getConfig();
    client = new PrismaClient({
      datasources: { db: { url: url ?? config.database.url } },
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
