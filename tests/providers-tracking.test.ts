import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@/lib/config';
import { resetStorage } from '@/lib/storage';
import { MetricaProvider } from '@/providers/metrica.provider';
import { SkillCornerProvider } from '@/providers/skillcorner.provider';
import { toCanonical } from '@/analytics/coordinates';
import { aggregatePlayers, aggregateTeamShape } from '@/analytics/tracking';

/**
 * Tracking providers (§15, §16).
 *
 * Fixtures mirror the published repository layouts exactly, so the mapping is
 * exercised end to end - including the coordinate origins, which differ per
 * provider and are the easiest thing to get silently wrong.
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
  sandbox = await mkdtemp(path.join(tmpdir(), 'scoutiq-tracking-'));
  resetConfig();
  resetStorage();
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
  resetConfig();
  resetStorage();
});

describe('SkillCorner open data (§15)', () => {
  async function fixtures(): Promise<string> {
    const root = path.join(sandbox, 'skillcorner');
    await mkdir(path.join(root, 'matches', '4039'), { recursive: true });

    await writeFile(
      path.join(root, 'matches.json'),
      JSON.stringify([
        {
          id: 4039,
          date_time: '2020-08-23T19:00:00Z',
          home_team: { id: 216, name: 'Bayern Munchen', short_name: 'BAY' },
          away_team: { id: 217, name: 'Paris Saint-Germain', short_name: 'PSG' },
          home_team_score: 1,
          away_team_score: 0,
          competition: { id: 1, name: 'Champions League' },
          season: { id: 2, name: '2019/2020' },
          stadium: { name: 'Estadio da Luz' },
        },
      ]),
    );

    await writeFile(
      path.join(root, 'matches', '4039', 'match_data.json'),
      JSON.stringify({
        id: 4039,
        date_time: '2020-08-23T19:00:00Z',
        home_team: { id: 216, name: 'Bayern Munchen' },
        away_team: { id: 217, name: 'Paris Saint-Germain' },
        pitch_length: 105,
        pitch_width: 68,
        players: [
          {
            id: 9001,
            trackable_object: 501,
            team_id: 216,
            first_name: 'Manuel',
            last_name: 'Neuer',
            birthday: '1986-03-27',
            player_role: { name: 'Goalkeeper', acronym: 'GK' },
          },
          {
            id: 9002,
            trackable_object: 502,
            team_id: 217,
            first_name: 'Kylian',
            last_name: 'Mbappe',
            player_role: { name: 'Forward', acronym: 'ST' },
          },
        ],
      }),
    );

    await writeFile(
      path.join(root, 'matches', '4039', 'structured_data.json'),
      JSON.stringify([
        {
          frame: 1,
          timestamp: '00:00:01.0',
          period: 1,
          possession: { group: 'home team' },
          data: [
            // SkillCorner's origin is the centre of the pitch.
            { trackable_object: 501, x: -50.0, y: 0.0 },
            { trackable_object: 502, x: 10.0, y: 12.0 },
            { trackable_object: 55, x: 0.0, y: 0.0, z: 0.1, group_name: 'ball' },
          ],
        },
        {
          frame: 2,
          timestamp: '00:00:01.1',
          period: 1,
          possession: { group: 'away team' },
          data: [
            { trackable_object: 501, x: -49.5, y: 0.2 },
            { trackable_object: 502, x: 10.8, y: 12.4 },
            { trackable_object: 55, x: 1.0, y: 0.5, z: 0.2, group_name: 'ball' },
          ],
        },
      ]),
    );

    return root;
  }

  it('reads matches and teams from the published layout', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), SKILLCORNER_LOCAL_PATH: root };
    resetConfig();

    const provider = new SkillCornerProvider();
    const matches = await provider.getMatches();
    const teams = await provider.getTeams();

    expect(matches[0]).toMatchObject({
      externalId: '4039',
      homeTeamExternalId: '216',
      awayTeamExternalId: '217',
      homeScore: 1,
      venue: 'Estadio da Luz',
    });
    expect(teams.map((team) => team.name).sort()).toEqual([
      'Bayern Munchen',
      'Paris Saint-Germain',
    ]);
  });

  it('maps players from the per-match roster', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), SKILLCORNER_LOCAL_PATH: root };
    resetConfig();

    const players = await new SkillCornerProvider().getPlayers();
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({
      externalId: '9001',
      fullName: 'Manuel Neuer',
      dateOfBirth: '1986-03-27',
      position: 'GK',
      teamExternalId: '216',
    });
  });

  it('shifts the centre origin onto ScoutIQ bottom-left metres', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), SKILLCORNER_LOCAL_PATH: root };
    resetConfig();

    const provider = new SkillCornerProvider();
    const frames = await provider.getTrackingData('4039');

    expect(frames).toHaveLength(2);
    const [first] = frames;

    // x -50 (deep in own half) becomes 2.5m from the goal line, y 0 becomes 34.
    const keeper = first?.players.find((player) => player.playerExternalId === '9001');
    expect(keeper).toMatchObject({ x: 2.5, y: 34, teamExternalId: '216' });

    // The ball at the centre spot lands on the centre spot.
    expect(first?.ball).toMatchObject({ x: 52.5, y: 34 });

    // Already canonical, so the transformation layer is a no-op for this provider.
    expect(provider.coordinateSystem).toBe('CANONICAL_105_68');
    expect(toCanonical({ x: 2.5, y: 34 }, provider.coordinateSystem)).toEqual({ x: 2.5, y: 34 });
  });

  it('resolves possession to the right team id', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), SKILLCORNER_LOCAL_PATH: root };
    resetConfig();

    const frames = await new SkillCornerProvider().getTrackingData('4039');
    expect(frames[0]?.possessionTeamExternalId).toBe('216');
    expect(frames[1]?.possessionTeamExternalId).toBe('217');
  });

  it('feeds the tracking engine, which turns frames into aggregates (§37)', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), SKILLCORNER_LOCAL_PATH: root };
    resetConfig();

    const frames = await new SkillCornerProvider().getTrackingData('4039');
    const shaped = frames.map((frame) => ({
      timestampMs: frame.timestampMs,
      period: frame.period,
      ballInPlay: frame.ballInPlay,
      possessionTeamId: frame.possessionTeamExternalId ?? null,
      players: frame.players.map((player) => ({
        playerId: player.playerExternalId,
        teamId: player.teamExternalId,
        x: player.x,
        y: player.y,
      })),
    }));

    const players = aggregatePlayers(shaped, 10);
    const keeper = players.find((player) => player.playerId === '9001');
    expect(keeper?.frames).toBe(2);
    expect(keeper?.distanceM).toBeCloseTo(0.54, 1);

    // Two players per team is below the three needed for a shape.
    expect(aggregateTeamShape(shaped, '216')).toEqual([]);
  });

  it('returns nothing rather than failing when a match has no tracking file', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), SKILLCORNER_LOCAL_PATH: root };
    resetConfig();

    expect(await new SkillCornerProvider().getTrackingData('9999')).toEqual([]);
  });

  it('states its licence conservatively (§13)', () => {
    const licence = new SkillCornerProvider().licence;
    expect(licence.commercialUseAllowed).toBe(false);
    expect(licence.redistributionAllowed).toBe(false);
  });
});

describe('Metrica sample data (§16)', () => {
  async function fixtures(): Promise<string> {
    const root = path.join(sandbox, 'metrica');
    await mkdir(path.join(root, 'Sample_Game_3'), { recursive: true });

    await writeFile(
      path.join(root, 'Sample_Game_3', 'Sample_Game_3_events.json'),
      JSON.stringify({
        data: [
          {
            index: 1,
            team: 'Home',
            type: { name: 'PASS' },
            subtype: { name: 'HEAD' },
            period: 1,
            start: { frame: 10, time: 65.4, x: 0.45, y: 0.35 },
            end: { frame: 30, time: 67.1, x: 0.62, y: 0.4 },
            from: { id: 'Player1' },
            to: { id: 'Player3' },
          },
          {
            index: 2,
            team: 'Away',
            type: { name: 'SHOT' },
            period: 1,
            start: { frame: 40, time: 70.0, x: 0.9, y: 0.5 },
            end: { frame: 45, time: 70.6, x: 1.0, y: 0.5 },
            from: { id: 'Player15' },
          },
        ],
      }),
    );

    await writeFile(
      path.join(root, 'Sample_Game_3', 'Sample_Game_3_tracking.json'),
      JSON.stringify([
        {
          frameIdx: 1,
          period: 1,
          time: 0.04,
          ball: { xyz: [0.5, 0.5, 0] },
          homePlayers: [{ playerId: 'Player1', xyz: [0.25, 0.5] }],
          awayPlayers: [{ playerId: 'Player15', xyz: [0.75, 0.5] }],
        },
      ]),
    );

    return root;
  }

  it('lists the sample games', async () => {
    process.env = baseEnv(sandbox);
    resetConfig();

    const matches = await new MetricaProvider().getMatches();
    expect(matches.map((match) => match.externalId)).toEqual([
      'metrica-game-1',
      'metrica-game-2',
      'metrica-game-3',
    ]);
  });

  it('maps events, keeping the passer and the receiver apart', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), METRICA_LOCAL_PATH: root };
    resetConfig();

    const events = await new MetricaProvider().getEvents('metrica-game-3');
    expect(events).toHaveLength(2);

    const [pass, shot] = events;
    expect(pass).toMatchObject({
      type: 'PASS',
      subType: 'HEAD',
      minute: 1,
      second: 5,
      teamExternalId: 'metrica-3-home',
      playerExternalId: 'metrica-3-home-Player1',
    });
    expect((pass?.detail as { pass: { recipientExternalId: string } }).pass.recipientExternalId).toBe(
      'metrica-3-home-Player3',
    );
    expect(shot?.type).toBe('SHOT');
  });

  it('declares normalised top-left coordinates, which the layer converts', async () => {
    const provider = new MetricaProvider();
    expect(provider.coordinateSystem).toBe('METRICA_0_1');

    // 0.9 along the pitch and centred, with y measured from the top.
    expect(toCanonical({ x: 0.9, y: 0.5 }, provider.coordinateSystem)).toEqual({ x: 94.5, y: 34 });
    expect(toCanonical({ x: 0, y: 0 }, provider.coordinateSystem)).toEqual({ x: 0, y: 68 });
  });

  it('maps synchronised tracking frames', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), METRICA_LOCAL_PATH: root };
    resetConfig();

    const frames = await new MetricaProvider().getTrackingData('metrica-game-3');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.players).toHaveLength(2);
    expect(frames[0]?.players[0]).toMatchObject({
      playerExternalId: 'metrica-3-home-Player1',
      teamExternalId: 'metrica-3-home',
    });
    expect(frames[0]?.ball).toMatchObject({ x: 0.5, y: 0.5 });
  });

  it('returns nothing for the CSV-only games rather than throwing', async () => {
    const root = await fixtures();
    process.env = { ...baseEnv(sandbox), METRICA_LOCAL_PATH: root };
    resetConfig();

    // Games 1 and 2 ship as CSV; the JSON reader must not fail on them.
    expect(await new MetricaProvider().getTrackingData('metrica-game-1')).toEqual([]);
    expect(await new MetricaProvider().getEvents('metrica-game-1')).toEqual([]);
  });
});
