import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { audit, clientIp } from '@/server/audit';
import { apiError, json, route } from '@/server/http';

/**
 * Delete a custom role (§29).
 *
 * System roles are not deletable: they ship with the app, other people's saved
 * work references them, and a reseed would bring them back anyway.
 */
export const DELETE = route(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const user = await requirePermission('analytics:run', request);
    const { id } = await context.params;

    const role = await prisma.playerRole.findUnique({ where: { id } });
    if (!role) return apiError(404, 'not_found', { message: 'No such role.' });
    if (role.isSystem) {
      return apiError(409, 'conflict', {
        message: 'System roles cannot be deleted. Deactivate it instead.',
      });
    }

    await prisma.playerRole.delete({ where: { id } });

    await audit({
      actorId: user.id,
      action: 'role.delete',
      entityType: 'player_role',
      entityId: id,
      summary: `Deleted role "${role.name}"`,
      ip: clientIp(request),
    });

    return json({ deleted: true });
  },
);
