import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { NetworkService } from '@/server/services/network.service';

/**
 * Passing network aggregation (§38).
 *
 * The service is exercised against a stub client so the shape of the maths is
 * tested without a database: nodes are centroids of located passes, edges are
 * completed passes with a named recipient.
 */

interface StubEvent {
  playerId: string | null;
  minute: number;
  x: number | null;
  y: number | null;
  endX: number | null;
  endY: number | null;
  pass: { recipientId: string | null; completed: boolean } | null;
}

const MATCH = '11111111-1111-1111-1111-111111111111';
const TEAM = '22222222-2222-2222-2222-222222222222';

const stub = (events: StubEvent[], names: Record<string, string>) =>
  ({
    team: { findUnique: async () => ({ name: 'Stub FC' }) },
    event: { findMany: async () => events },
    player: {
      findMany: async () =>
        Object.entries(names).map(([id, fullName]) => ({ id, fullName, knownAs: null })),
    },
  }) as unknown as PrismaClient;

const pass = (
  playerId: string,
  recipientId: string | null,
  x: number,
  y: number,
  completed = true,
  minute = 10,
  end: [number, number] | null = null,
): StubEvent => ({
  playerId,
  minute,
  x,
  y,
  endX: end?.[0] ?? null,
  endY: end?.[1] ?? null,
  pass: { recipientId, completed },
});

describe('passingNetwork', () => {
  it('places a node at the centroid of the positions the data gives it', async () => {
    const service = new NetworkService(
      stub(
        [pass('a', 'b', 20, 30), pass('a', 'b', 40, 40), pass('b', 'a', 60, 34)],
        { a: 'Ann Archer', b: 'Bo Berg' },
      ),
    );

    const result = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });
    const ann = result.nodes.find((node) => node.playerId === 'a');

    expect(ann?.x).toBe(30);
    expect(ann?.y).toBe(35);
    expect(ann?.passes).toBe(2);
    expect(ann?.received).toBe(1);
  });

  it('counts an edge per direction and honours the minimum', async () => {
    const service = new NetworkService(
      stub(
        [pass('a', 'b', 20, 30), pass('a', 'b', 22, 32), pass('b', 'a', 60, 34)],
        { a: 'Ann Archer', b: 'Bo Berg' },
      ),
    );

    const both = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });
    expect(both.edges).toEqual([
      { from: 'a', to: 'b', passes: 2 },
      { from: 'b', to: 'a', passes: 1 },
    ]);

    const filtered = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 2 });
    expect(filtered.edges).toEqual([{ from: 'a', to: 'b', passes: 2 }]);
  });

  it('ignores incomplete passes and passes with no named recipient', async () => {
    const service = new NetworkService(
      stub(
        [
          pass('a', 'b', 20, 30, false, 10, [50, 30]),
          pass('a', null, 25, 30, true, 10, [55, 30]),
          pass('a', 'b', 30, 30, true, 10, [60, 30]),
        ],
        { a: 'Ann Archer', b: 'Bo Berg' },
      ),
    );

    const result = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });

    expect(result.totalPasses).toBe(3);
    expect(result.completedPasses).toBe(2);
    expect(result.linkedPasses).toBe(1);
    expect(result.edges).toEqual([{ from: 'a', to: 'b', passes: 1 }]);
  });

  it('drops a player with no located pass rather than parking them on the centre spot', async () => {
    const service = new NetworkService(
      stub(
        [
          {
            playerId: 'a',
            minute: 5,
            x: null,
            y: null,
            endX: null,
            endY: null,
            pass: { recipientId: 'b', completed: true },
          },
          pass('b', 'a', 60, 34),
        ],
        { a: 'Ann Archer', b: 'Bo Berg' },
      ),
    );

    const result = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });

    expect(result.nodes.map((node) => node.playerId)).toEqual(['b']);
    // An edge whose endpoint has no position cannot be drawn, so it is dropped.
    expect(result.edges).toEqual([]);
  });

  it('records the window a player was on the ball in', async () => {
    const service = new NetworkService(
      stub([pass('a', 'b', 20, 30, true, 12), pass('a', 'b', 22, 32, true, 71)], {
        a: 'Ann Archer',
        b: 'Bo Berg',
      }),
    );

    const result = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });
    const ann = result.nodes.find((node) => node.playerId === 'a');

    expect(ann?.firstMinute).toBe(12);
    expect(ann?.lastMinute).toBe(71);
  });

  it('places a receiver at the ends of the passes they received', async () => {
    const service = new NetworkService(
      stub([pass('a', 'b', 20, 30, true, 10, [80, 40]), pass('a', 'b', 22, 32, true, 20, [90, 20])], {
        a: 'Ann Archer',
        b: 'Bo Berg',
      }),
    );

    const result = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });
    const bo = result.nodes.find((node) => node.playerId === 'b');

    expect(bo?.x).toBe(85);
    expect(bo?.y).toBe(30);
    expect(bo?.passes).toBe(0);
    expect(bo?.received).toBe(2);
  });

  it('never lets a self-pass become an edge', async () => {
    const service = new NetworkService(
      stub([pass('a', 'a', 20, 30)], { a: 'Ann Archer' }),
    );

    const result = await service.passingNetwork({ matchId: MATCH, teamId: TEAM, minPasses: 1 });
    expect(result.edges).toEqual([]);
  });
});
