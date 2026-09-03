import { redirect } from 'next/navigation';
import { prisma } from '@/db/client';
import { can, getSessionUser } from '@/server/auth';
import { SEARCHABLE_METRICS } from '@/server/services/search.service';
import { humanise } from '@/reports/blocks';
import { RoleBuilder, type ExistingRole } from '@/components/role-builder';

export const dynamic = 'force-dynamic';

/** Custom role builder (§29, §84). Analyst and admin only. */
export default async function RolesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!can(user.role, 'analytics:run')) redirect('/');

  const [rows, seasons] = await Promise.all([
    prisma.playerRole.findMany({
      include: {
        requirements: { orderBy: { weight: 'desc' } },
        _count: { select: { scores: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { positionGroup: 'asc' }, { name: 'asc' }],
    }),
    prisma.competitionSeason.findMany({
      where: { playerSeasonMetric: { some: {} } },
      include: { competition: { select: { name: true } } },
      orderBy: { seasonName: 'desc' },
    }),
  ]);

  const roles: ExistingRole[] = rows.map((role) => ({
    id: role.id,
    key: role.key,
    name: role.name,
    positionGroup: role.positionGroup,
    description: role.description,
    minMinutes: role.minMinutes,
    isSystem: role.isSystem,
    scored: role._count.scores,
    requirements: role.requirements.map((requirement) => ({
      metricKey: requirement.metricKey,
      weight: requirement.weight,
      direction: requirement.direction,
    })),
  }));

  return (
    <RoleBuilder
      canEdit={can(user.role, 'analytics:run')}
      roles={roles}
      metrics={SEARCHABLE_METRICS.filter((key) => key !== 'minutes' && key !== 'matches').map(
        (key) => ({ key, label: humanise(key) }),
      )}
      seasons={seasons.map((season) => ({
        id: season.id,
        label: `${season.competition.name} ${season.seasonName}`,
      }))}
    />
  );
}
