import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/db/client';

/**
 * Passing network (§38).
 *
 * Nodes are players placed at the average of the positions the data actually
 * puts them in - where their own passes started, and where the passes they
 * received ended; edges are completed passes between two team-mates. The classic caveat applies and is shown in the
 * UI: average position is a centroid, not a formation, and a substitute's
 * centroid rests on far fewer touches than a starter's.
 */

export type NetworkPeriod = 'full' | 'first' | 'second';

/**
 * Play patterns that are not settled possession.
 *
 * Named as the providers write them - StatsBomb's vocabulary, which the
 * importer stores verbatim rather than mapping to an enum, because a pattern a
 * provider invents tomorrow should not become an import error today.
 */
export const DEAD_BALL_PATTERNS = [
  'From Corner',
  'From Free Kick',
  'From Throw In',
  'From Goal Kick',
  'From Kick Off',
  'From Keeper',
  'From Set Piece',
] as const;

export interface PassingNetworkQuery {
  matchId: string;
  teamId: string;
  period?: NetworkPeriod;
  /**
   * "Possession only" (§38): open-play passes belonging to this team's own
   * possession. Excludes set-piece patterns (corners, free kicks, throw-ins,
   * goal kicks, kick-offs) and anything played during the opponent's
   * possession, which is where the shape of a settled attack gets lost.
   */
  possessionOnly?: boolean;
  /** Drop edges below this many passes so the picture stays readable. */
  minPasses?: number;
}

export interface PassingNetworkNode {
  playerId: string;
  name: string;
  x: number;
  y: number;
  passes: number;
  received: number;
  /** Minute the player's first and last recorded pass fall in. */
  firstMinute: number;
  lastMinute: number;
}

export interface PassingNetworkEdge {
  from: string;
  to: string;
  passes: number;
}

export interface PassingNetworkResult {
  matchId: string;
  teamId: string;
  teamName: string;
  period: NetworkPeriod;
  possessionOnly: boolean;
  minPasses: number;
  totalPasses: number;
  completedPasses: number;
  /** Completed passes that named a recipient - only these can form edges. */
  linkedPasses: number;
  nodes: PassingNetworkNode[];
  edges: PassingNetworkEdge[];
}

export class NetworkService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async passingNetwork(query: PassingNetworkQuery): Promise<PassingNetworkResult> {
    const period = query.period ?? 'full';
    const possessionOnly = query.possessionOnly ?? false;
    const minPasses = query.minPasses ?? 2;

    const team = await this.prisma.team.findUnique({
      where: { id: query.teamId },
      select: { name: true },
    });

    const periodNumber = period === 'first' ? 1 : period === 'second' ? 2 : null;

    const events = await this.prisma.event.findMany({
      where: {
        matchId: query.matchId,
        teamId: query.teamId,
        type: 'PASS',
        ...(periodNumber !== null ? { period: { period: periodNumber } } : {}),
        ...(possessionOnly
          ? {
              possessionTeamId: query.teamId,
              OR: [{ playPattern: null }, { playPattern: { notIn: [...DEAD_BALL_PATTERNS] } }],
            }
          : {}),
      },
      select: {
        playerId: true,
        minute: true,
        x: true,
        y: true,
        endX: true,
        endY: true,
        pass: { select: { recipientId: true, completed: true } },
      },
      orderBy: { sequenceIndex: 'asc' },
    });

    interface Accumulator {
      sumX: number;
      sumY: number;
      located: number;
      passes: number;
      received: number;
      firstMinute: number;
      lastMinute: number;
    }

    const nodes = new Map<string, Accumulator>();
    const edges = new Map<string, number>();
    let completed = 0;
    let linked = 0;

    const touch = (playerId: string): Accumulator => {
      let entry = nodes.get(playerId);
      if (!entry) {
        entry = {
          sumX: 0,
          sumY: 0,
          located: 0,
          passes: 0,
          received: 0,
          firstMinute: Number.POSITIVE_INFINITY,
          lastMinute: 0,
        };
        nodes.set(playerId, entry);
      }
      return entry;
    };

    for (const event of events) {
      if (!event.playerId) continue;

      const passer = touch(event.playerId);
      passer.passes += 1;
      passer.firstMinute = Math.min(passer.firstMinute, event.minute);
      passer.lastMinute = Math.max(passer.lastMinute, event.minute);

      if (event.x !== null && event.y !== null) {
        passer.sumX += event.x;
        passer.sumY += event.y;
        passer.located += 1;
      }

      if (!event.pass?.completed) continue;
      completed += 1;

      const recipientId = event.pass.recipientId;
      if (!recipientId || recipientId === event.playerId) continue;
      linked += 1;

      const recipient = touch(recipientId);
      recipient.received += 1;
      recipient.firstMinute = Math.min(recipient.firstMinute, event.minute);
      recipient.lastMinute = Math.max(recipient.lastMinute, event.minute);

      // Where a completed pass ended is where its receiver was. Without this a
      // player who only receives - a striker holding the line - would have no
      // position at all and every link to them would vanish from the picture.
      if (event.endX !== null && event.endY !== null) {
        recipient.sumX += event.endX;
        recipient.sumY += event.endY;
        recipient.located += 1;
      }

      const key = `${event.playerId}|${recipientId}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }

    const playerIds = [...nodes.keys()];
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, fullName: true, knownAs: true },
    });
    const names = new Map(players.map((player) => [player.id, player.knownAs ?? player.fullName]));

    // A node with no located pass has no honest position, so it is dropped
    // rather than parked on the centre spot (§92).
    const resolved: PassingNetworkNode[] = [];
    for (const [playerId, entry] of nodes) {
      if (entry.located === 0) continue;
      resolved.push({
        playerId,
        name: names.get(playerId) ?? 'Unknown',
        x: entry.sumX / entry.located,
        y: entry.sumY / entry.located,
        passes: entry.passes,
        received: entry.received,
        firstMinute: Number.isFinite(entry.firstMinute) ? entry.firstMinute : 0,
        lastMinute: entry.lastMinute,
      });
    }
    resolved.sort((a, b) => b.passes - a.passes);

    const placed = new Set(resolved.map((node) => node.playerId));
    const resolvedEdges: PassingNetworkEdge[] = [];
    for (const [key, passes] of edges) {
      if (passes < minPasses) continue;
      const [from, to] = key.split('|');
      if (!from || !to || !placed.has(from) || !placed.has(to)) continue;
      resolvedEdges.push({ from, to, passes });
    }
    resolvedEdges.sort((a, b) => b.passes - a.passes);

    return {
      matchId: query.matchId,
      teamId: query.teamId,
      teamName: team?.name ?? 'Unknown team',
      period,
      possessionOnly,
      minPasses,
      totalPasses: events.length,
      completedPasses: completed,
      linkedPasses: linked,
      nodes: resolved,
      edges: resolvedEdges,
    };
  }
}

export const networkService = new NetworkService();
