import { MetricDirection } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, parseBody, route } from '@/server/http';
import { SEARCHABLE_METRICS } from '@/server/services/search.service';

/** Role definitions as data (§28, §84) - editable without a redeploy. */
export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);

  const roles = await prisma.playerRole.findMany({
    include: { requirements: { orderBy: { weight: 'desc' } }, _count: { select: { scores: true } } },
    orderBy: [{ positionGroup: 'asc' }, { name: 'asc' }],
  });

  return json(roles);
});

/**
 * Custom role builder (§29, §84).
 *
 * A role is a row, not a redeployment: name it, name its metrics and weights,
 * and the analytics engine scores every player against it on the next run.
 */
const requirementSchema = z.object({
  metricKey: z.enum(SEARCHABLE_METRICS as unknown as [string, ...string[]]),
  weight: z.number().min(0.05).max(10),
  direction: z.nativeEnum(MetricDirection).default(MetricDirection.HIGHER_BETTER),
  minPercentile: z.number().min(0).max(100).nullable().optional(),
  description: z.string().max(300).optional(),
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  positionGroup: z.enum(['GK', 'DF', 'MF', 'FW']),
  description: z.string().max(1000).optional(),
  minMinutes: z.number().int().min(0).max(5000).default(450),
  requirements: z.array(requirementSchema).min(1).max(15),
});

/** `Ball-Winning Midfielder` -> `ball-winning-midfielder`. */
const toKey = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const POST = route(async (request: Request) => {
  const user = await requirePermission('analytics:run', request);
  const body = await parseBody(request, createSchema);

  const key = toKey(body.name);
  if (!key) return apiError(400, 'bad_request', { message: 'That name has no usable characters.' });

  const existing = await prisma.playerRole.findUnique({ where: { key } });
  if (existing) {
    return apiError(409, 'conflict', { message: 'A role with that name already exists.' });
  }

  const seen = new Set<string>();
  for (const requirement of body.requirements) {
    if (seen.has(requirement.metricKey)) {
      return apiError(400, 'bad_request', {
        message: `${requirement.metricKey} is listed twice; each metric may appear once.`,
      });
    }
    seen.add(requirement.metricKey);
  }

  const role = await prisma.playerRole.create({
    data: {
      key,
      name: body.name,
      positionGroup: body.positionGroup,
      description: body.description ?? null,
      minMinutes: body.minMinutes,
      // A user-built role is never a system role: system roles ship with the
      // app and must survive a reseed untouched.
      isSystem: false,
      createdById: user.id,
      requirements: {
        create: body.requirements.map((requirement) => ({
          metricKey: requirement.metricKey,
          weight: requirement.weight,
          direction: requirement.direction,
          minPercentile: requirement.minPercentile ?? null,
          description: requirement.description ?? null,
        })),
      },
    },
    include: { requirements: true },
  });

  await audit({
    actorId: user.id,
    action: 'role.create',
    entityType: 'player_role',
    entityId: role.id,
    summary: `Created role "${role.name}" for ${role.positionGroup} with ${role.requirements.length} metrics`,
    ip: clientIp(request),
  });

  return json(role, { status: 201 });
});
