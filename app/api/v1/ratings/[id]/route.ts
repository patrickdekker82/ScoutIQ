import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, route } from '@/server/http';

/**
 * Delete one's own scout rating (§49).
 *
 * A scout may withdraw their own judgement; an admin may remove anyone's. One
 * scout silently deleting another's rating would make the record untrustworthy.
 */
export const DELETE = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requirePermission('notes:write', request);
    const { id } = await context.params;

    const rating = await prisma.scoutRating.findUnique({ where: { id } });
    if (!rating) return apiError(404, 'not_found', { message: 'No such rating.' });

    if (rating.authorId !== user.id && user.role !== 'ADMIN') {
      return apiError(403, 'forbidden', {
        message: 'Only the scout who wrote a rating, or an admin, may remove it.',
      });
    }

    await prisma.scoutRating.delete({ where: { id } });

    await audit({
      actorId: user.id,
      action: 'rating.delete',
      entityType: 'player',
      entityId: rating.playerId,
      summary: 'Removed a scout rating',
      ip: clientIp(request),
    });

    return json({ deleted: true });
  },
);
