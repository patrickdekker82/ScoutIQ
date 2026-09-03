import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PITCH_LENGTH_M } from '@/analytics/coordinates';
import { DemoProvider } from '@/providers/demo.provider';

/**
 * Shot orientation (§33, §39).
 *
 * Canonical coordinates have EVERY team attacking left-to-right, from the
 * acting team's own perspective. Code that mirrors one side "so both attack
 * the same goal" therefore does the opposite: it moves that side's shots into
 * its own defensive third, where the shot map's half-pitch viewBox cannot even
 * draw them. These tests pin the convention down so it cannot come back.
 */
const REPO_ROOT = path.resolve(__dirname, '..');

describe('canonical shot coordinates', () => {
  it('puts both teams shooting at the same end', async () => {
    const provider = new DemoProvider(6);
    const events = await provider.getEvents('demo-match-0');
    const shots = events.filter((event) => event.type === 'SHOT');

    expect(shots.length).toBeGreaterThan(5);

    const teams = [...new Set(shots.map((shot) => shot.teamExternalId))];
    expect(teams.length).toBe(2);

    // Every shot, from either team, is in the attacking half.
    for (const shot of shots) {
      expect(shot.x, `shot at x=${shot.x} is not in the attacking half`).toBeGreaterThan(
        PITCH_LENGTH_M / 2,
      );
    }
  });

  it('is not undone by a mirror in the match page or the report builder', async () => {
    const [page, service] = await Promise.all([
      readFile(path.join(REPO_ROOT, 'app/(app)/matches/[id]/page.tsx'), 'utf8'),
      readFile(path.join(REPO_ROOT, 'server/services/report.service.ts'), 'utf8'),
    ]);

    // The specific mirror that used to be here: 105 - x for the away side.
    for (const [name, source] of [['match page', page], ['report service', service]] as const) {
      expect(source, `${name} mirrors away shots again`).not.toMatch(/105 - \(?shot\.x/);
      expect(source, `${name} mirrors away shots again`).not.toMatch(/68 - \(?shot\.y/);
    }
  });
});
