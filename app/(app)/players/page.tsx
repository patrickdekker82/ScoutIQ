import { PlayerSearch } from '@/components/player-search';
import { prisma } from '@/db/client';

export const dynamic = 'force-dynamic';

/** Advanced player search (§45). */
export default async function PlayersPage() {
  const seasons = await prisma.competitionSeason.findMany({
    where: { playerSeasonMetric: { some: {} } },
    include: { competition: { select: { name: true } } },
    orderBy: { seasonName: 'desc' },
  });

  return (
    <PlayerSearch
      seasons={seasons.map((season) => ({
        id: season.id,
        label: `${season.competition.name} ${season.seasonName}`,
      }))}
    />
  );
}
