import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPrismaClient } from '@erp/database';

/**
 * Postgres provisioning for the integration tests (`*.int.spec.ts`).
 *
 * The tests run against the Postgres the repo already uses (the `postgres` service in
 * compose.yaml, or the `postgres` service container in CI), found through `DATABASE_URL`.
 * They never touch that database itself. Instead:
 *
 * 1. `global-setup.ts` creates one migrated template database per run.
 * 2. Each Vitest worker clones its own database from the template (one database per worker,
 *    so workers cannot see each other's rows).
 * 3. Each scenario resets its worker's database and reloads the TOR Section 8.1 fixture.
 */

const DEFAULT_DATABASE_URL = 'postgresql://erp:erp@localhost:5432/erp';
/** Every database this harness creates starts with this, so a crashed run can be cleaned up. */
export const TEST_DATABASE_PREFIX = 'erp_test_';
export const TEMPLATE_DATABASE = `${TEST_DATABASE_PREFIX}template`;

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The URL of the server's own database, used only to create and drop test databases. */
export function adminDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** The same server and credentials, pointed at another database. */
export function urlForDatabase(name: string): string {
  const url = new URL(adminDatabaseUrl());
  url.pathname = `/${name}`;
  return url.toString();
}

/** One database per Vitest worker. Vitest numbers its workers from 1. */
export function workerDatabaseName(): string {
  return `${TEST_DATABASE_PREFIX}w${process.env.VITEST_POOL_ID ?? '0'}`;
}

/** Runs `fn` with a client on the server's own database, then disconnects. */
export async function withAdminClient<T>(
  fn: (admin: ReturnType<typeof createPrismaClient>) => Promise<T>,
): Promise<T> {
  const admin = createPrismaClient(adminDatabaseUrl());
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

/** The names are generated here, never user input, but they are quoted anyway. */
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

export async function dropTestDatabases(): Promise<void> {
  await withAdminClient(async (admin) => {
    const rows = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DATABASE_PREFIX}%`}`;
    for (const { datname } of rows) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoted(datname)} WITH (FORCE)`);
    }
  });
}

/** Creates the template database and applies every migration to it with `prisma migrate deploy`. */
export async function createMigratedTemplate(): Promise<void> {
  await withAdminClient((admin) =>
    admin.$executeRawUnsafe(`CREATE DATABASE ${quoted(TEMPLATE_DATABASE)}`),
  );
  const result = spawnSync('pnpm --filter @erp/database exec prisma migrate deploy', {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: urlForDatabase(TEMPLATE_DATABASE) },
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `prisma migrate deploy failed for the test template:\n${result.stdout}\n${result.stderr}`,
    );
  }
}

/** Creates this worker's database from the migrated template unless an earlier file already did. */
export async function ensureWorkerDatabase(): Promise<string> {
  const name = workerDatabaseName();
  await withAdminClient(async (admin) => {
    const existing = await admin.$queryRaw<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname = ${name}`;
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(
        `CREATE DATABASE ${quoted(name)} TEMPLATE ${quoted(TEMPLATE_DATABASE)}`,
      );
    }
  });
  return urlForDatabase(name);
}
