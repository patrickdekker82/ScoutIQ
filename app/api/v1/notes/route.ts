import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit } from '@/server/audit';
import { json, parseBody, route } from '@/server/http';

const schema = z
  .object({
    playerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    matchId: z.string().uuid().optional(),
    eventId: z.string().uuid().optional(),
    shortlistId: z.string().uuid().optional(),
    minute: z.number().int().min(0).max(130).optional(),
    second: z.number().int().min(0).max(59).optional(),
    body: z.string().min(1).max(8000),
    tags: z.array(z.string().max(40)).max(10).optional(),
  })
  .refine(
    (value) => value.playerId ?? value.teamId ?? value.matchId ?? value.shortlistId,
    'A note must be attached to a player, team, match or shortlist',
  );

/** Scouting notes (§48), optionally stamped with a match clock. */
export const POST = route(async (request: Request) => {
  const user = await requirePermission('notes:write', request);
  const body = await parseBody(request, schema);

  const note = await prisma.scoutingNote.create({
    data: {
      authorId: user.id,
      playerId: body.playerId ?? null,
      teamId: body.teamId ?? null,
      matchId: body.matchId ?? null,
      eventId: body.eventId ?? null,
      shortlistId: body.shortlistId ?? null,
      minute: body.minute ?? null,
      second: body.second ?? null,
      body: body.body,
      tags: body.tags ?? [],
    },
    include: { author: { select: { displayName: true } } },
  });

  await audit({
    actorId: user.id,
    action: 'note.create',
    entityType: 'note',
    entityId: note.id,
    summary: 'Added a scouting note',
    details: { playerId: body.playerId ?? null, matchId: body.matchId ?? null },
  });

  return json(note, { status: 201 });
});
