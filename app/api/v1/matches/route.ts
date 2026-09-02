import { z } from 'zod';
import { prisma } from '@/db/client';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';

const querySchema = z.object({
  competitionSeasonId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export const GET = route(async (request: Request) => {
  await requirePermission('data:read', request);
  const query = parseQuery(request, querySchema);

  const where = {
    ...(query.competitionSeasonId ? { competitionSeasonId: query.competitionSeasonId } : {}),
    ...(query.teamId
      ? { OR: [{ homeTeamId: query.teamId }, { awayTeamId: query.teamId }] }
      : {}),
  };

  const [total, matches] = await Promise.all([
    prisma.match.count({ where }),
    prisma.match.findMany({
      where,
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        season: { include: { competition: { select: { name: true } } } },
        _count: { select: { events: true } },
      },
      orderBy: { kickoffAt: 'desc' },
      take: query.take,
      skip: query.skip,
    }),
  ]);

  return json({
    total,
    items: matches.map((match) => ({
      id: match.id,
      kickoffAt: match.kickoffAt,
      competition: match.season.competition.name,
      season: match.season.seasonName,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      matchweek: match.matchweek,
      eventCount: match._count.events,
      isDemo: match.isDemo,
    })),
  });
});
