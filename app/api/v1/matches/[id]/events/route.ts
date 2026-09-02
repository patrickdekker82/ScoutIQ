import { EventType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';

type Context = { params: Promise<{ id: string }> };

const querySchema = z.object({
  type: z.string().optional(),
  playerId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  minuteFrom: z.coerce.number().int().min(0).optional(),
  minuteTo: z.coerce.number().int().min(0).optional(),
  take: z.coerce.number().int().min(1).max(2000).default(500),
  skip: z.coerce.number().int().min(0).default(0),
});

/**
 * Event browser (§89).
 *
 * Always paginated: a full match is thousands of events and §59 forbids
 * shipping them all to a browser.
 */
export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;
  const query = parseQuery(request, querySchema);

  const types = query.type
    ? query.type
        .split(',')
        .map((entry) => entry.trim().toUpperCase())
        .filter((entry): entry is EventType =>
          (Object.values(EventType) as string[]).includes(entry),
        )
    : undefined;

  const where = {
    matchId: id,
    ...(types?.length ? { type: { in: types } } : {}),
    ...(query.playerId ? { playerId: query.playerId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
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
      include: {
        player: { select: { id: true, fullName: true } },
        team: { select: { id: true, name: true } },
        pass: true,
        shot: true,
        carry: true,
        duel: true,
        provider: { select: { key: true, name: true } },
      },
      orderBy: [{ minute: 'asc' }, { second: 'asc' }, { sequenceIndex: 'asc' }],
      take: query.take,
      skip: query.skip,
    }),
  ]);

  return json({
    total,
    take: query.take,
    skip: query.skip,
    items: events.map((event) => ({
      id: event.id,
      minute: event.minute,
      second: event.second,
      type: event.type,
      subType: event.subType,
      player: event.player,
      team: event.team,
      x: event.x,
      y: event.y,
      endX: event.endX,
      endY: event.endY,
      outcome: event.outcome,
      underPressure: event.underPressure,
      detail: event.pass ?? event.shot ?? event.carry ?? event.duel ?? null,
      // Provenance travels with the event (§11): every number is traceable.
      provenance: {
        provider: event.provider?.key ?? null,
        providerEventId: event.providerEventId,
        importId: event.dataImportId,
      },
    })),
  });
});
