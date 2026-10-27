import type { User } from '@erp/contracts';
import { createPrismaClient, loadStartingFixture, type PrismaClient } from '@erp/database';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { ensureWorkerDatabase } from './database.js';

/** Tables the reset leaves alone: Prisma's own migration history. */
const KEPT_TABLES = new Set(['_prisma_migrations']);

/** Empties every table, then loads the TOR Section 8.1 starting data. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const names = tables
    .map((row) => row.tablename)
    .filter((name) => !KEPT_TABLES.has(name))
    .map((name) => `"${name}"`);
  // TRUNCATE does not fire the row-level triggers that keep the movement ledger append-only.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
  await loadStartingFixture(prisma);
}

/**
 * Call once inside a `describe` (or at the top of a file). Connects to this worker's own
 * database before the file's tests, resets it to the Section 8.1 starting data before every
 * scenario so no scenario relies on another, and disconnects afterwards.
 */
export function useIntegrationDatabase() {
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    prisma = createPrismaClient(await ensureWorkerDatabase());
  });
  beforeEach(async () => {
    await resetDatabase(prisma!);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  return {
    get prisma(): PrismaClient {
      return prisma!;
    },
    /** A fixture user as `AuthGuard` would put it on the request. */
    async userByEmail(email: string): Promise<User> {
      return prisma!.user.findUniqueOrThrow({
        where: { email },
        select: { id: true, email: true, name: true, role: true, storeId: true },
      });
    },
  };
}
