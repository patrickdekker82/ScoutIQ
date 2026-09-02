import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@/lib/config';
import { resetStorage } from '@/lib/storage';
import { DemoProvider } from '@/providers/demo.provider';
import { parseCsv } from '@/providers/csv-json.provider';
import { StatsBombProvider } from '@/providers/statsbomb.provider';
import { toCanonical } from '@/analytics/coordinates';

/**
 * Provider adapters (§87).
 *
 * The open-data importers are exercised against local fixtures in the exact
 * layout the public repositories use, so the mapping is tested without a
 * network call.
 */

let sandbox: string;

const baseEnv = (dataRoot: string): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@db:5432/scoutiq',
  REDIS_URL: 'redis://cache:6379',
  AUTH_SECRET: 'x'.repeat(32),
  DATA_ROOT: dataRoot,
});

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'scoutiq-provider-'));
  resetConfig();
  resetStorage();
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
  resetConfig();
  resetStorage();
});

describe('StatsBomb open data adapter (§14)', () => {
  async function fixtures(): Promise<string> {
    const root = path.join(sandbox, 'statsbomb');
    await mkdir(path.join(root, 'matches', '11'), { recursive: true });
    await mkdir(path.join(root, 'events'), { recursive: true });
    await mkdir(path.join(root, 'lineups'), { recursive: true });

    await writeFile(
      path.join(root, 'competitions.json'),
      JSON.stringify([
        {
          competition_id: 11,
          season_id: 90,
          country_name: 'Spain',
          competition_name: 'La Liga',
          competition_gender: 'male',
          season_name: '2020/2021',
        },
      ]),
    );

    await writeFile(
      path.join(root, 'matches', '11', '90.json'),
      JSON.stringify([
        {
          match_id: 3773386,
          match_date: '2021-01-10',
          kick_off: '21:00:00.000',
          competition: { competition_id: 11, competition_name: 'La Liga', country_name: 'Spain' },
          season: { season_id: 90, season_name: '2020/2021' },
          home_team: { home_team_id: 217, home_team_name: 'Barcelona' },
          away_team: { away_team_id: 206, away_team_name: 'Granada' },
          home_score: 4,
          away_score: 0,
          match_week: 18,
          stadium: { name: 'Camp Nou' },
          referee: { name: 'A. Referee' },
        },
      ]),
    );

    await writeFile(
      path.join(root, 'lineups', '3773386.json'),
      JSON.stringify([
        {
          team_id: 217,
          team_name: 'Barcelona',
          formation: 4231,
          lineup: [
            {
              player_id: 5503,
              player_name: 'Lionel Andres Messi Cuccittini',
              player_nickname: 'Lionel Messi',
              jersey_number: 10,
              country: { name: 'Argentina' },
              positions: [
                { position: 'Right Wing', from: '00:00', to: null, start_reason: 'Starting XI' },
              ],
            },
          ],
        },
      ]),
    );

    await writeFile(
      path.join(root, 'events', '3773386.json'),
      JSON.stringify([
        {
          id: 'event-1',
          index: 1,
          period: 1,
          timestamp: '00:01:23.456',
          minute: 1,
          second: 23,
          type: { id: 30, name: 'Pass' },
          possession: 3,
          possession_team: { id: 217, name: 'Barcelona' },
          play_pattern: { name: 'Regular Play' },
          team: { id: 217, name: 'Barcelona' },
          player: { id: 5503, name: 'Lionel Messi' },
          location: [60, 40],
          under_pressure: true,
          pass: {
            recipient: { id: 5504, name: 'Team Mate' },
            length: 22.5,
            angle: 0.3,
            height: { name: 'Ground Pass' },
            end_location: [96, 30],
            body_part: { name: 'Left Foot' },
            technique: { name: 'Through Ball' },
            shot_assist: true,
          },
        },
        {
          id: 'event-2',
          index: 2,
          period: 1,
          timestamp: '00:01:25.000',
          minute: 1,
          second: 25,
          type: { id: 16, name: 'Shot' },
          team: { id: 217, name: 'Barcelona' },
          player: { id: 5504, name: 'Team Mate' },
          location: [110, 40],
          shot: {
            statsbomb_xg: 0.42,
            end_location: [120, 40, 1.2],
            outcome: { name: 'Goal' },
            body_part: { name: 'Right Foot' },
            type: { name: 'Open Play' },
          },
        },
      ]),
    );

    return root;
  }

  it('reads competitions, seasons, matches and teams from the repository layout', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), STATSBOMB_LOCAL_PATH: root };
    resetConfig();

    const provider = new StatsBombProvider();
    expect(provider.isConfigured()).toBe(true);

    const competitions = await provider.getCompetitions();
    expect(competitions).toEqual([
      expect.objectContaining({ externalId: '11', name: 'La Liga', country: 'Spain' }),
    ]);

    const seasons = await provider.getSeasons('11');
    expect(seasons[0]).toMatchObject({ externalId: '90', name: '2020/2021' });

    const matches = await provider.getMatches({
      competitionExternalId: '11',
      seasonExternalId: '90',
    });
    expect(matches[0]).toMatchObject({
      externalId: '3773386',
      homeTeamExternalId: '217',
      awayTeamExternalId: '206',
      homeScore: 4,
      venue: 'Camp Nou',
    });

    const teams = await provider.getTeams({
      competitionExternalId: '11',
      seasonExternalId: '90',
    });
    expect(teams.map((team) => team.name).sort()).toEqual(['Barcelona', 'Granada']);
  });

  it('maps players out of the lineups, keeping provider ids', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), STATSBOMB_LOCAL_PATH: root };
    resetConfig();

    const players = await new StatsBombProvider().getPlayers({
      competitionExternalId: '11',
      seasonExternalId: '90',
    });

    expect(players[0]).toMatchObject({
      externalId: '5503',
      knownAs: 'Lionel Messi',
      nationality: 'Argentina',
      teamExternalId: '217',
    });
  });

  it('normalises events, including the absent-outcome-means-complete rule', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), STATSBOMB_LOCAL_PATH: root };
    resetConfig();

    const events = await new StatsBombProvider().getEvents('3773386');
    const [pass, shot] = events;

    expect(pass).toMatchObject({ type: 'PASS', minute: 1, second: 23, timestampMs: 83456 });
    const passDetail = (pass?.detail as { pass: Record<string, unknown> }).pass;
    // StatsBomb records no outcome for a completed pass.
    expect(passDetail.completed).toBe(true);
    expect(passDetail.isThroughBall).toBe(true);
    expect(passDetail.isKeyPass).toBe(true);
    expect(passDetail.bodyPart).toBe('LEFT_FOOT');

    const shotDetail = (shot?.detail as { shot: Record<string, unknown> }).shot;
    expect(shotDetail.xg).toBe(0.42);
    expect(shotDetail.isGoal).toBe(true);
    expect(shotDetail.onTarget).toBe(true);
  });

  it('declares a coordinate system the transformation layer understands', async () => {
    const provider = new StatsBombProvider();
    expect(provider.coordinateSystem).toBe('STATSBOMB_120_80');
    // A StatsBomb shot at [110, 40] is 10 units from goal, centred.
    expect(toCanonical({ x: 110, y: 40 }, provider.coordinateSystem)).toEqual({ x: 96.25, y: 34 });
  });

  it('states its licence conservatively (§13)', () => {
    const licence = new StatsBombProvider().licence;
    expect(licence.commercialUseAllowed).toBe(false);
    expect(licence.redistributionAllowed).toBe(false);
    expect(licence.attributionRequired).toBe(true);
  });
});

describe('demo provider (§73)', () => {
  it('produces a complete league without any key or network access', async () => {
    process.env = baseEnv(sandbox);
    resetConfig();

    const provider = new DemoProvider(6);
    expect(provider.isConfigured()).toBe(true);

    const [competitions, teams, players, matches] = await Promise.all([
      provider.getCompetitions(),
      provider.getTeams(),
      provider.getPlayers(),
      provider.getMatches(),
    ]);

    expect(competitions[0]?.name).toContain('DEMO DATA');
    expect(teams).toHaveLength(6);
    expect(players.length).toBeGreaterThan(60);
    expect(matches).toHaveLength(6);

    const events = await provider.getEvents('demo-match-0');
    expect(events.length).toBeGreaterThan(500);
    expect(events.every((event) => event.x !== null && event.y !== null)).toBe(true);
  });

  it('is deterministic, so two installations produce the same demo league', async () => {
    process.env = baseEnv(sandbox);
    resetConfig();

    const first = await new DemoProvider(4).getEvents('demo-match-1');
    const second = await new DemoProvider(4).getEvents('demo-match-1');
    expect(first).toEqual(second);
  });

  it('labels its content as fabricated', () => {
    const licence = new DemoProvider().licence;
    expect(licence.notes).toMatch(/synthetic/i);
  });
});

describe('CSV parsing (§55)', () => {
  it('handles quotes, embedded commas and escaped quotes', () => {
    const rows = parseCsv(
      'name,club,note\n"de Vries, Sem",Ajax,"He said ""great"" movement"\nJansen,PSV,ok\n',
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: 'de Vries, Sem',
      club: 'Ajax',
      note: 'He said "great" movement',
    });
    expect(rows[1]?.club).toBe('PSV');
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
