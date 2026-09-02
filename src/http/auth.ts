import type { FastifyReply, FastifyRequest } from 'fastify';
import { getConfig } from '../config/env.js';
import { verifyToken, type TokenPayload } from '../domain/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

/** Bearer-token guard. Optionally requires one of the given roles. */
export function requireAuth(roles?: readonly string[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token, getConfig().auth.secret) : null;

    if (!payload) {
      await reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (roles && !roles.includes(payload.role)) {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }

    request.user = payload;
  };
}
