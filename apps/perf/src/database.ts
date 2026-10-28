import { spawnSync } from 'node:child_process';
import { createPrismaClient } from '@erp/database';
import { config } from './config.js';

/** The name is checked in config.ts to be lowercase letters, digits and underscores. */
const quoted = (name: string) => `"${name}"`;

/**
 * Drops the performance database if it exists, creates it empty and applies every migration.
 * Starting from nothing each time is what makes a run repeatable. The name always starts with
 * `erp_perf` (see config.ts), so the development database is never touched.
 */
export async function recreatePerfDatabase(): Promise<void> {
  const admin = createPrismaClient(config.adminDatabaseUrl);
  try {
    const name = quoted(config.perfDatabaseName);
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
  } finally {
    await admin.$disconnect();
  }

  const result = spawnSync('pnpm --filter @erp/database exec prisma migrate deploy', {
    cwd: config.repoRoot,
    env: { ...process.env, DATABASE_URL: config.perfDatabaseUrl },
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}
