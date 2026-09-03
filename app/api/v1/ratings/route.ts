import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { json, parseBody, parseQuery, route } from '@/server/http';

/**
 * Manual scout ratings (§49).
 *
 * Human judgement, kept in its own table and never folded into the analytics.
 * §49 is explicit: these must not enter automated scoring without a deliberate
 * configuration, so nothing in the analytics pipeline reads this endpoint.
 */

const RATING = z.number().int().min(1).max(100);

const createSchema = z.object({
  playerId: z.string().uuid(),
  matchId: z.string().uuid().optional(),
  technical: RATING,
  tactical: RATING,
  physical: RATING,
  mental: RATING,
  potential: RATING,
  overall: RATING,
  notes: z.string().max(4000).optional(),
});

const querySchema = z.object({
  playerId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const ratings = await prisma.scoutRating.findMany({
    where: { playerId: query.playerId },
    include: {
      author: { select: { id: true, displayName: true } },
      match: {
        select: {
          id: true,
          kickoffAt: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });

  return json(ratings);
});

export const POST = route(async (request: Request) => {
  const user = await requirePermission('notes:write', request);
  const body = await parseBody(request, createSchema);

  const rating = await prisma.scoutRating.create({
    data: {
      playerId: body.playerId,
      authorId: user.id,
      matchId: body.matchId ?? null,
      technical: body.technical,
      tactical: body.tactical,
      physical: body.physical,
      mental: body.mental,
      potential: body.potential,
      overall: body.overall,
      notes: body.notes ?? null,
    },
    include: { author: { select: { id: true, displayName: true } } },
  });

  await audit({
    actorId: user.id,
    action: 'rating.create',
    entityType: 'player',
    entityId: body.playerId,
    summary: `Rated a player ${body.overall}/100 overall`,
    ip: clientIp(request),
  });

  return json(rating, { status: 201 });
});
