import { requireUser } from '@/server/auth';
import { json, route } from '@/server/http';
import { PERMISSIONS, can, type Permission } from '@/server/auth';

export const GET = route(async (request: Request) => {
  const user = await requireUser(request);

  return json({
    ...user,
    permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((permission) =>
      can(user.role, permission),
    ),
  });
});
