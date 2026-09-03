import { EventType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';

/**
 * Events (§79).
 *
 * Always scoped: an unfiltered event table is millions of rows and no useful
 * answer, so at least one of match, player or team must be named.
 */
const querySchema = z
  .object({
    matchId: z.string().uuid().optional(),
    playerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    type: z.nativeEnum(EventType).optional(),
    minuteFrom: z.coerce.number().int().min(0).max(130).optional(),
    minuteTo: z.coerce.number().int().min(0).max(130).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (value) => Boolean(value.matchId ?? value.playerId ?? value.teamId),
    'Name at least one of matchId, playerId or teamId',
  );

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const where = {
    ...(query.matchId ? { matchId: query.matchId } : {}),
    ...(query.playerId ? { playerId: query.playerId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.minuteFrom !== undefined || query.minuteTo !== undefined
      ? {
          minute: {
            ...(query.minuteFrom !== undefined ? { gte: query.minuteFrom } : {}),
            ...(query.minuteTo !== undefined ? { lte: query.minuteTo } : {}),
          },
        }
      : {}),
  };

  const [total, events] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      select: {
        id: true,
        matchId: true,
        teamId: true,
        playerId: true,
        type: true,
        subType: true,
        minute: true,
        second: true,
        period: { select: { period: true } },
        x: true,
        y: true,
        endX: true,
        endY: true,
        outcome: true,
        playPattern: true,
        underPressure: true,
        player: { select: { fullName: true } },
        team: { select: { name: true } },
      },
      orderBy: [{ minute: 'asc' }, { second: 'asc' }, { sequenceIndex: 'asc' }],
      take: query.limit,
      skip: query.offset,
    }),
  ]);

  return json({ total, limit: query.limit, offset: query.offset, events });
});
