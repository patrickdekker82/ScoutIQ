import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { requireAuth } from '../auth.js';

const listQuery = z.object({
  search: z.string().trim().min(1).optional(),
  position: z.string().trim().min(1).optional(),
  season: z.string().trim().min(1).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function playerRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();

  app.get('/players', { preHandler: requireAuth() }, async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query' });
    const { search, position, season, minScore, take, skip } = parsed.data;

    const [items, total] = await Promise.all([
      prisma.player.findMany({
        where: {
          ...(position ? { position: { equals: position, mode: 'insensitive' } } : {}),
          ...(search
            ? {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' as const } },
                  { lastName: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
          ...(season || minScore !== undefined
            ? {
                metrics: {
                  some: {
                    ...(season ? { season } : {}),
                    ...(minScore !== undefined ? { scoutScore: { gte: minScore } } : {}),
                  },
                },
              }
            : {}),
        },
        include: {
          team: { select: { id: true, name: true, country: true } },
          metrics: { orderBy: { season: 'desc' }, take: 1 },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take,
        skip,
      }),
      prisma.player.count(),
    ]);

    return { total, take, skip, items };
  });

  app.get('/players/:id', { preHandler: requireAuth() }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const player = await prisma.player.findUnique({
      where: { id },
      include: {
        team: true,
        metrics: { orderBy: { season: 'desc' } },
        reports: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!player) return reply.code(404).send({ error: 'not_found' });
    return player;
  });

  app.get('/players/:id/matches', { preHandler: requireAuth() }, async (request) => {
    const { id } = request.params as { id: string };
    return prisma.playerMatchStat.findMany({
      where: { playerId: id },
      include: {
        match: {
          include: {
            competition: { select: { name: true, season: true } },
            homeTeam: { select: { name: true } },
            awayTeam: { select: { name: true } },
          },
        },
      },
      orderBy: { match: { kickoffAt: 'desc' } },
      take: 100,
    });
  });
}
