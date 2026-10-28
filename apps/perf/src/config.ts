import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NFR05 } from './verdict.js';

/**
 * What a run is configured with. The defaults are the NFR-05 requirement itself; the variables
 * exist so a developer can try the harness with a shorter run. A shortened run still produces a
 * report, but the verdict marks it as failed because it did not run the required 5 minutes.
 */

try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // No .env file: the defaults below apply.
}

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive whole number, got "${raw}".`);
  }
  return value;
}

/** The server's own database, used to create and drop the performance database. */
const serverUrl = process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp';

/** Only a database with this prefix is ever dropped, so a typo cannot reach the dev data. */
export const PERF_DATABASE_PREFIX = 'erp_perf';
const databaseName = process.env.PERF_DATABASE ?? PERF_DATABASE_PREFIX;
if (!databaseName.startsWith(PERF_DATABASE_PREFIX) || !/^[a-z0-9_]+$/.test(databaseName)) {
  throw new Error(
    `PERF_DATABASE must be lowercase letters, digits and underscores and start with "${PERF_DATABASE_PREFIX}", got "${databaseName}".`,
  );
}

function urlFor(name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export const config = {
  repoRoot,
  adminDatabaseUrl: serverUrl,
  perfDatabaseName: databaseName,
  perfDatabaseUrl: urlFor(databaseName),
  apiPort: positiveInt('PERF_API_PORT', 3100),
  virtualUsers: positiveInt('PERF_VIRTUAL_USERS', NFR05.virtualUsers),
  durationMs: positiveInt('PERF_DURATION_SECONDS', NFR05.durationMs / 1000) * 1000,
  /** Where the evidence is archived. Committed with the pull request that produced it. */
  resultsDir: process.env.PERF_RESULTS_DIR ?? join(repoRoot, 'docs', 'evidence', 'nfr-05'),
  seed: 20_260_101,
};
