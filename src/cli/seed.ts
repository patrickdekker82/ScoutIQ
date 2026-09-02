import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../domain/auth.js';

/**
 * Minimal seed: one admin account plus a small, synthetic dataset so a fresh
 * deployment can be verified end-to-end (analytics + reports) on any host.
 *
 * The admin password comes from the environment; there is no default password
 * baked into the image.
 */
const prisma = new PrismaClient();

const SEASON = '2025/2026';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@scoutiq.local';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error('SEED_ADMIN_PASSWORD is required (min. 8 characters) to seed an admin user');
  }

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN', active: true },
    create: {
      email,
      displayName: process.env.SEED_ADMIN_NAME ?? 'ScoutIQ Admin',
      passwordHash: await hashPassword(password),
      role: 'ADMIN',
    },
  });

  const competition = await prisma.competition.upsert({
    where: { name_season: { name: 'Eredivisie', season: SEASON } },
    update: {},
    create: { name: 'Eredivisie', season: SEASON, country: 'Netherlands', tier: 1 },
  });

  const teams = await Promise.all(
    ['Ajax', 'PSV', 'Feyenoord', 'AZ'].map((name) =>
      prisma.team.upsert({
        where: { name_country: { name, country: 'Netherlands' } },
        update: { competitionId: competition.id },
        create: { name, country: 'Netherlands', competitionId: competition.id },
      }),
    ),
  );

  const roster = [
    { firstName: 'Sem', lastName: 'de Vries', position: 'FW' },
    { firstName: 'Luuk', lastName: 'Jansen', position: 'MF' },
    { firstName: 'Daan', lastName: 'Bakker', position: 'DF' },
    { firstName: 'Bram', lastName: 'Visser', position: 'GK' },
    { firstName: 'Finn', lastName: 'Smit', position: 'FW' },
    { firstName: 'Noah', lastName: 'Meijer', position: 'MF' },
  ];

  const players = [];
  for (const [index, entry] of roster.entries()) {
    const team = teams[index % teams.length]!;
    const existing = await prisma.player.findFirst({
      where: { firstName: entry.firstName, lastName: entry.lastName },
    });
    players.push(
      existing ??
        (await prisma.player.create({
          data: { ...entry, nationality: 'Netherlands', teamId: team.id },
        })),
    );
  }

  // Deterministic pseudo-random stats: the same seed produces the same numbers
  // on every machine, which makes post-migration verification meaningful.
  let state = 42;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  for (let round = 0; round < 6; round += 1) {
    const home = teams[round % teams.length]!;
    const away = teams[(round + 1) % teams.length]!;
    const kickoffAt = new Date(Date.UTC(2025, 7 + round, 10, 18, 45));

    const match =
      (await prisma.match.findFirst({
        where: { competitionId: competition.id, homeTeamId: home.id, awayTeamId: away.id, kickoffAt },
      })) ??
      (await prisma.match.create({
        data: {
          competitionId: competition.id,
          homeTeamId: home.id,
          awayTeamId: away.id,
          kickoffAt,
          homeGoals: Math.floor(next() * 4),
          awayGoals: Math.floor(next() * 3),
        },
      }));

    for (const player of players) {
      const minutes = 60 + Math.floor(next() * 30);
      const passes = 20 + Math.floor(next() * 50);
      const duels = 5 + Math.floor(next() * 15);
      const stats = {
        minutesPlayed: minutes,
        goals: next() > 0.75 ? 1 : 0,
        assists: next() > 0.85 ? 1 : 0,
        shots: Math.floor(next() * 5),
        xg: Number((next() * 0.8).toFixed(2)),
        xa: Number((next() * 0.5).toFixed(2)),
        passes,
        passesCompleted: Math.floor(passes * (0.7 + next() * 0.25)),
        progressivePasses: Math.floor(next() * 12),
        duelsWon: Math.floor(duels * (0.4 + next() * 0.4)),
        duelsTotal: duels,
      };

      await prisma.playerMatchStat.upsert({
        where: { playerId_matchId: { playerId: player.id, matchId: match.id } },
        update: stats,
        create: { playerId: player.id, matchId: match.id, ...stats },
      });
    }
  }

  await prisma.dataProvider.upsert({
    where: { key: 'local-file' },
    update: {},
    create: { key: 'local-file', name: 'Local file drop' },
  });

  process.stdout.write(
    `Seeded admin ${admin.email}, ${players.length} players, ${teams.length} teams for ${SEASON}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
