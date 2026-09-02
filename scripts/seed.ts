import { PrismaClient, UserRole } from '@prisma/client';
import { SYSTEM_ROLES } from '@/analytics/roles';
import { hashPassword } from '@/server/auth-core';

/**
 * Seed: the minimum a fresh installation needs to be useful.
 *
 *   1. an admin account (password from the environment - no default in the image)
 *   2. the 19 system roles as DATA (§28, §84)
 *
 * Demo football data is NOT seeded here: it comes from the demo provider
 * through the normal import pipeline (`npm run ingest:demo`), so the demo path
 * exercises exactly the same code as a real import.
 */
const prisma = new PrismaClient();

async function seedRoles(): Promise<number> {
  let count = 0;

  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.playerRole.upsert({
      where: { key: definition.key },
      update: {
        name: definition.name,
        positionGroup: definition.positionGroup,
        description: definition.description,
        minMinutes: definition.minMinutes,
      },
      create: {
        key: definition.key,
        name: definition.name,
        positionGroup: definition.positionGroup,
        description: definition.description,
        minMinutes: definition.minMinutes,
        isSystem: true,
      },
    });

    for (const requirement of definition.requirements) {
      await prisma.playerRoleRequirement.upsert({
        where: {
          playerRoleId_metricKey: { playerRoleId: role.id, metricKey: requirement.metricKey },
        },
        update: { weight: requirement.weight, direction: requirement.direction },
        create: {
          playerRoleId: role.id,
          metricKey: requirement.metricKey,
          weight: requirement.weight,
          direction: requirement.direction,
          ...(requirement.description ? { description: requirement.description } : {}),
        },
      });
    }

    count += 1;
  }

  return count;
}

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@scoutiq.local';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required (min. 8 characters). ScoutIQ ships no default password.',
    );
  }

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: UserRole.ADMIN, active: true },
    create: {
      email,
      displayName: process.env.SEED_ADMIN_NAME ?? 'ScoutIQ Admin',
      passwordHash: await hashPassword(password),
      role: UserRole.ADMIN,
    },
  });

  const roles = await seedRoles();

  process.stdout.write(
    `Seeded admin ${admin.email} and ${roles} player roles.\n` +
      `Next: npm run ingest:demo   (loads the demo league)\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
