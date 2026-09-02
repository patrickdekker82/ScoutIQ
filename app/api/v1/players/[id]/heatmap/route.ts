import { HeatmapType } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '@/server/auth';
import { json, parseQuery, route } from '@/server/http';
import { HeatmapService } from '@/server/services/heatmap.service';

type Context = { params: Promise<{ id: string }> };

const querySchema = z.object({
  type: z.nativeEnum(HeatmapType).default(HeatmapType.TOUCH),
  algorithm: z.enum(['GRID_DENSITY', 'HEXBIN', 'GAUSSIAN_KDE']).default('GRID_DENSITY'),
  cols: z.coerce.number().int().min(4).max(60).optional(),
  rows: z.coerce.number().int().min(4).max(40).optional(),
  bandwidth: z.coerce.number().min(1).max(20).optional(),
  half: z.coerce.number().int().min(1).max(2).optional(),
  minuteFrom: z.coerce.number().int().min(0).max(130).optional(),
  minuteTo: z.coerce.number().int().min(0).max(130).optional(),
  possession: z.enum(['IN', 'OUT']).optional(),
  matchId: z.string().uuid().optional(),
  competitionSeasonId: z.string().uuid().optional(),
});

/** Heatmap for one player (§34, §35). Only the grid crosses the wire (§59). */
export const GET = route(async (request: Request, context: Context) => {
  await requirePermission('data:read', request);
  const { id } = await context.params;
  const query = parseQuery(request, querySchema);

  const result = await new HeatmapService().build({
    playerId: id,
    type: query.type,
    algorithm: query.algorithm,
    ...(query.cols ? { cols: query.cols } : {}),
    ...(query.rows ? { rows: query.rows } : {}),
    ...(query.bandwidth ? { bandwidth: query.bandwidth } : {}),
    ...(query.half ? { half: query.half as 1 | 2 } : {}),
    ...(query.minuteFrom !== undefined ? { minuteFrom: query.minuteFrom } : {}),
    ...(query.minuteTo !== undefined ? { minuteTo: query.minuteTo } : {}),
    ...(query.possession ? { possession: query.possession } : {}),
    ...(query.matchId ? { matchId: query.matchId } : {}),
    ...(query.competitionSeasonId ? { competitionSeasonId: query.competitionSeasonId } : {}),
  });

  return json(result);
});
