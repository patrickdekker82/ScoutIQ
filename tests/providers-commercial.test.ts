import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@/lib/config';
import { ApiFootballProvider } from '@/providers/api-football.provider';
import { SportmonksProvider } from '@/providers/sportmonks.provider';

/**
 * Commercial API providers (§12, phase 8 of §88).
 *
 * These need a paid subscription, so the mapping is verified against a local
 * server that answers with the shapes the vendors document. That checks the
 * three things that actually break: the request path, the authentication
 * header, and the response mapping - none of which need a real key.
 */

interface Recorded {
  path: string;
  headers: Record<string, string | string[] | undefined>;
}

let server: Server;
let baseUrl: string;
const requests: Recorded[] = [];

const SPORTMONKS: Record<string, unknown> = {
  '/leagues': {
    data: [{ id: 501, name: 'Premiership', type: 'league', country_id: 1161 }],
  },
  '/seasons?filters=leagueId:501': {
    data: [
      { id: 19735, league_id: 501, name: '2022/2023', starting_at: '2022-07-30', ending_at: '2023-05-27' },
    ],
  },
  '/teams/seasons/19735': {
    data: [{ id: 62, name: 'Rangers', short_code: 'RAN', founded: 1872 }],
  },
  '/squads/teams/62': {
    data: [
      {
        id: 172,
        firstname: 'Allan',
        lastname: 'McGregor',
        display_name: 'A. McGregor',
        date_of_birth: '1982-01-31',
        height: 188,
        weight: 84,
        position: { name: 'Goalkeeper' },
      },
    ],
  },
  '/fixtures?filters=fixtureSeasons:19735&include=participants;scores': {
    data: [
      {
        id: 18535517,
        league_id: 501,
        season_id: 19735,
        starting_at: '2022-07-30 14:00:00',
        participants: [
          { id: 62, meta: { location: 'home' } },
          { id: 53, meta: { location: 'away' } },
        ],
        scores: [
          { description: 'CURRENT', score: { goals: 2, participant: 'home' } },
          { description: 'CURRENT', score: { goals: 1, participant: 'away' } },
        ],
      },
    ],
  },
};

const API_FOOTBALL: Record<string, unknown> = {
  '/leagues': {
    response: [
      {
        league: { id: 88, name: 'Eredivisie', type: 'League' },
        country: { name: 'Netherlands' },
        seasons: [{ year: 2023, start: '2023-08-11', end: '2024-05-19' }],
      },
    ],
  },
  '/leagues?id=88': {
    response: [
      {
        league: { id: 88, name: 'Eredivisie', type: 'League' },
        country: { name: 'Netherlands' },
        seasons: [{ year: 2023, start: '2023-08-11', end: '2024-05-19' }],
      },
    ],
  },
  '/teams?league=88&season=2023': {
    response: [
      { team: { id: 194, name: 'Ajax', code: 'AJA', country: 'Netherlands', founded: 1900 } },
    ],
  },
  '/players?team=194&season=2023': {
    response: [
      {
        player: {
          id: 2937,
          firstname: 'Steven',
          lastname: 'Berghuis',
          name: 'S. Berghuis',
          birth: { date: '1991-12-19' },
          nationality: 'Netherlands',
          height: '182 cm',
        },
        statistics: [{ games: { position: 'Midfielder' } }],
      },
    ],
  },
  '/fixtures?league=88&season=2023': {
    response: [
      {
        fixture: { id: 1035037, date: '2023-08-12T18:45:00+00:00', venue: { name: 'Johan Cruijff ArenA' } },
        league: { id: 88, season: 2023, round: 'Regular Season - 1' },
        teams: { home: { id: 194 }, away: { id: 197 } },
        goals: { home: 4, away: 1 },
      },
    ],
  },
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = request.url ?? '/';
    requests.push({ path: url, headers: request.headers });

    // Both vendors are served from one process; the path prefix picks the set.
    const [, vendor, ...rest] = url.split('/');
    const route = `/${rest.join('/')}`;
    const table = vendor === 'sportmonks' ? SPORTMONKS : API_FOOTBALL;
    const body = table[decodeURIComponent(route)];

    response.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body ?? { error: 'not_found', path: route }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests.length = 0;
});

const env = (overrides: Record<string, string | undefined>): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@db:5432/scoutiq',
    REDIS_URL: 'redis://cache:6379',
    AUTH_SECRET: 'x'.repeat(32),
    ...overrides,
  }) as NodeJS.ProcessEnv;

describe('Sportmonks', () => {
  const configure = () => {
    process.env = env({
      SPORTMONKS_API_KEY: 'test-key-123',
      SPORTMONKS_BASE_URL: `${baseUrl}/sportmonks`,
    });
    resetConfig();
    return new SportmonksProvider();
  };

  it('is unconfigured without a key, and the pipeline simply skips it', () => {
    process.env = env({ SPORTMONKS_BASE_URL: `${baseUrl}/sportmonks` });
    resetConfig();
    expect(new SportmonksProvider().isConfigured()).toBe(false);
  });

  it('sends the key as a header and never in the URL (§62, §92)', async () => {
    await configure().getCompetitions();

    const [request] = requests;
    expect(request?.headers.authorization).toBe('test-key-123');
    expect(request?.path).not.toContain('test-key-123');
  });

  it('maps competitions, seasons, teams and players', async () => {
    const provider = configure();

    expect(await provider.getCompetitions()).toEqual([
      expect.objectContaining({ externalId: '501', name: 'Premiership', type: 'LEAGUE' }),
    ]);

    expect((await provider.getSeasons('501'))[0]).toMatchObject({
      externalId: '19735',
      name: '2022/2023',
      startDate: '2022-07-30',
    });

    expect((await provider.getTeams({ seasonExternalId: '19735' }))[0]).toMatchObject({
      externalId: '62',
      name: 'Rangers',
      shortName: 'RAN',
      founded: 1872,
    });

    expect((await provider.getPlayers({ teamExternalId: '62' }))[0]).toMatchObject({
      externalId: '172',
      fullName: 'A. McGregor',
      dateOfBirth: '1982-01-31',
      heightCm: 188,
      position: 'Goalkeeper',
    });
  });

  it('resolves home and away from the participants meta', async () => {
    const matches = await configure().getMatches({ seasonExternalId: '19735' });

    expect(matches[0]).toMatchObject({
      externalId: '18535517',
      homeTeamExternalId: '62',
      awayTeamExternalId: '53',
      homeScore: 2,
      awayScore: 1,
    });
  });

  it('says what it needs rather than guessing', async () => {
    await expect(configure().getMatches({})).rejects.toThrow(/seasonExternalId/);
  });

  it('declares that redistribution is not granted', () => {
    expect(new SportmonksProvider().licence.redistributionAllowed).toBe(false);
    expect(new SportmonksProvider().licence.commercialUseAllowed).toBe(true);
  });
});

describe('API-Football', () => {
  const configure = () => {
    process.env = env({
      API_FOOTBALL_KEY: 'af-key-456',
      API_FOOTBALL_BASE_URL: `${baseUrl}/apifootball`,
    });
    resetConfig();
    return new ApiFootballProvider();
  };

  it('is unconfigured without a key', () => {
    process.env = env({ API_FOOTBALL_BASE_URL: `${baseUrl}/apifootball` });
    resetConfig();
    expect(new ApiFootballProvider().isConfigured()).toBe(false);
  });

  it('sends the vendor-specific key header', async () => {
    await configure().getCompetitions();
    expect(requests[0]?.headers['x-apisports-key']).toBe('af-key-456');
  });

  it('maps competitions and seasons out of the nested response', async () => {
    const provider = configure();

    expect((await provider.getCompetitions())[0]).toMatchObject({
      externalId: '88',
      name: 'Eredivisie',
      country: 'Netherlands',
      type: 'LEAGUE',
    });

    expect((await provider.getSeasons('88'))[0]).toMatchObject({
      externalId: '2023',
      name: '2023/2024',
    });
  });

  it('parses the height string into centimetres', async () => {
    const players = await configure().getPlayers({
      teamExternalId: '194',
      seasonExternalId: '2023',
    });

    expect(players[0]).toMatchObject({
      externalId: '2937',
      fullName: 'S. Berghuis',
      heightCm: 182,
      position: 'Midfielder',
    });
  });

  it('maps fixtures with the venue and round', async () => {
    const matches = await configure().getMatches({
      competitionExternalId: '88',
      seasonExternalId: '2023',
    });

    expect(matches[0]).toMatchObject({
      externalId: '1035037',
      homeTeamExternalId: '194',
      awayTeamExternalId: '197',
      homeScore: 4,
      awayScore: 1,
      venue: 'Johan Cruijff ArenA',
      stage: 'Regular Season - 1',
    });
  });

  it('requires the parameters its endpoints need', async () => {
    await expect(configure().getTeams({})).rejects.toThrow(/competitionExternalId/);
  });
});

describe('unsupported capabilities', () => {
  it('report themselves instead of failing an import (§12)', async () => {
    process.env = env({
      SPORTMONKS_API_KEY: 'test-key-123',
      SPORTMONKS_BASE_URL: `${baseUrl}/sportmonks`,
    });
    resetConfig();

    const provider = new SportmonksProvider();
    expect(provider.capabilities.events).toBe(false);
    await expect(provider.getEvents('1')).rejects.toThrow(/does not support events/);
    await expect(provider.getTrackingData('1')).rejects.toThrow(/tracking data/);
  });
});
