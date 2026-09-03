import { ShortlistStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit } from '@/server/audit';
import { apiError, json, parseBody, route } from '@/server/http';

export const GET = route(async (request: Request) => {
  const user = await requirePermission('data:read', request);

  const shortlists = await prisma.shortlist.findMany({
    where: { OR: [{ ownerId: user.id }, { archived: false }] },
    include: {
      owner: { select: { displayName: true } },
      season: { include: { competition: { select: { name: true } } } },
      _count: { select: { players: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return json(shortlists);
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  competitionSeasonId: z.string().uuid().optional(),
  positionGroup: z.enum(['GK', 'DF', 'MF', 'FW']).optional(),
});

export const POST = route(async (request: Request) => {
  const user = await requirePermission('shortlists:write', request);
  const body = await parseBody(request, createSchema);

  const shortlist = await prisma.shortlist.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      competitionSeasonId: body.competitionSeasonId ?? null,
      positionGroup: body.positionGroup ?? null,
      ownerId: user.id,
    },
  });

  await audit({
    actorId: user.id,
    action: 'shortlist.update',
    entityType: 'shortlist',
    entityId: shortlist.id,
    summary: `Created shortlist "${shortlist.name}"`,
  });

  return json(shortlist, { status: 201 });
});

const entrySchema = z.object({
  shortlistId: z.string().uuid(),
  playerId: z.string().uuid(),
  status: z.nativeEnum(ShortlistStatus).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  scoutRating: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(4000).optional(),
});

/** Add or update a player on a shortlist (§47). */
export const PUT = route(async (request: Request) => {
  const user = await requirePermission('shortlists:write', request);
  const body = await parseBody(request, entrySchema);

  const entry = await prisma.shortlistPlayer.upsert({
    where: {
      shortlistId_playerId: { shortlistId: body.shortlistId, playerId: body.playerId },
    },
    update: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.scoutRating !== undefined ? { scoutRating: body.scoutRating } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
    create: {
      shortlistId: body.shortlistId,
      playerId: body.playerId,
      status: body.status ?? ShortlistStatus.NEW,
      priority: body.priority ?? 3,
      scoutRating: body.scoutRating ?? null,
      notes: body.notes ?? null,
      addedById: user.id,
    },
  });

  await audit({
    actorId: user.id,
    action: 'shortlist.update',
    entityType: 'shortlist',
    entityId: body.shortlistId,
    summary: `Updated player on shortlist`,
    details: { playerId: body.playerId, status: entry.status },
  });

  return json(entry);
});

const removeSchema = z.object({
  shortlistId: z.string().uuid(),
  playerId: z.string().uuid(),
});

/** Take a player off a shortlist (§47). */
export const DELETE = route(async (request: Request) => {
  const user = await requirePermission('shortlists:write', request);

  const url = new URL(request.url);
  const parsed = removeSchema.safeParse({
    shortlistId: url.searchParams.get('shortlistId') ?? '',
    playerId: url.searchParams.get('playerId') ?? '',
  });
  if (!parsed.success) {
    return apiError(400, 'bad_request', { message: 'Name both the shortlist and the player.' });
  }

  const entry = await prisma.shortlistPlayer.findUnique({
    where: {
      shortlistId_playerId: {
        shortlistId: parsed.data.shortlistId,
        playerId: parsed.data.playerId,
      },
    },
  });
  if (!entry) return apiError(404, 'not_found', { message: 'That player is not on this list.' });

  await prisma.shortlistPlayer.delete({ where: { id: entry.id } });

  await audit({
    actorId: user.id,
    action: 'shortlist.update',
    entityType: 'shortlist',
    entityId: parsed.data.shortlistId,
    summary: 'Removed a player from a shortlist',
    details: { playerId: parsed.data.playerId },
  });

  return json({ deleted: true });
});
