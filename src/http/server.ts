import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify';
import { getConfig } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { importRoutes } from './routes/imports.js';
import { playerRoutes } from './routes/players.js';
import { reportRoutes } from './routes/reports.js';

export async function buildServer(): Promise<FastifyInstance> {
  const config = getConfig();

  const app = Fastify({
    // Cast keeps the instance type identical to Fastify's default, so route
    // plugins stay portable across the app.
    loggerInstance: logger as FastifyBaseLogger,
    // Behind a reverse proxy on any host; trust its forwarding headers rather
    // than assuming a specific proxy or IP.
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.http.corsOrigins, credentials: true });

  app.get('/', async () => ({
    name: 'ScoutIQ',
    version: process.env.npm_package_version ?? '0.1.0',
    docs: `${config.http.publicBaseUrl}/health/ready`,
  }));

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(playerRoutes, { prefix: '/api/v1' });
  await app.register(importRoutes, { prefix: '/api/v1' });
  await app.register(reportRoutes, { prefix: '/api/v1' });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error.message }, 'request failed');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    void reply.code(status).send({ error: status === 500 ? 'internal_error' : error.message });
  });

  return app;
}
