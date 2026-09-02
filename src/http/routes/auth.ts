import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config/env.js';
import { issueToken, verifyPassword } from '../../domain/auth.js';
import { getPrisma } from '../../lib/prisma.js';
import { requireAuth } from '../auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    // Always run the comparison path shape-wise; do not leak which half failed.
    const valid =
      user?.active === true && (await verifyPassword(parsed.data.password, user.passwordHash));

    if (!user || !valid) return reply.code(401).send({ error: 'invalid_credentials' });

    const { auth } = getConfig();
    const token = issueToken({ sub: user.id, role: user.role }, auth.secret, auth.tokenTtlSeconds);

    return {
      token,
      expiresIn: auth.tokenTtlSeconds,
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
    };
  });

  app.get('/auth/me', { preHandler: requireAuth() }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.sub } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
  });
}
