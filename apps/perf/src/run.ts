import { createPrismaClient } from '@erp/database';
import { startApi } from './api-process.js';
import { config } from './config.js';
import { recreatePerfDatabase } from './database.js';
import { seedPerfDataset } from './dataset.js';
import { runLoad, signIn } from './load.js';
import { writeReport } from './report.js';
import { evaluate } from './verdict.js';

/**
 * `pnpm perf`: the NFR-05 load test, end to end. Recreates the performance database, seeds
 * 1,000 products and 10,000 movements, starts the built API on it, drives the product-search
 * and stock-view APIs with the configured virtual users for the configured time, then judges
 * the result and archives the report. Exits 1 when NFR-05 is not met.
 */

const log = (line: string) => console.log(`[perf] ${line}`);

log(`Recreating database ${config.perfDatabaseName} and applying migrations`);
await recreatePerfDatabase();

log('Seeding the dataset');
const dataset = await seedPerfDataset();
log(`Seeded ${dataset.products} products and ${dataset.movements} stock movements`);

const startedAt = new Date();
const api = await startApi();
let outcome;
try {
  const cookie = await signIn(dataset.userEmail);
  log(`Driving the load: ${config.virtualUsers} users for ${config.durationMs / 1000} s`);
  outcome = await runLoad({
    dataset,
    cookie,
    virtualUsers: config.virtualUsers,
    durationMs: config.durationMs,
    onProgress: log,
  });
} finally {
  await api.stop();
}

const admin = createPrismaClient(config.adminDatabaseUrl);
const postgresVersion = await admin.$queryRaw<{ version: string }[]>`SELECT version()`
  .then((rows) => rows[0]?.version ?? 'unknown')
  .finally(() => admin.$disconnect());

const run = {
  dataset: { products: dataset.products, movements: dataset.movements },
  virtualUsers: outcome.virtualUsers,
  durationMs: outcome.durationMs,
  endpoints: outcome.endpoints,
};
const verdict = evaluate(run);
const files = writeReport(config.resultsDir, { startedAt, postgresVersion, run, verdict });

for (const [name, s] of Object.entries(verdict.endpoints)) {
  log(
    `${name}: p95 ${s.p95Ms.toFixed(1)} ms over ${s.requests} requests (${s.failedRequests} failed)`,
  );
}
log(`Report: ${files.markdown}`);
log(verdict.passed ? 'NFR-05 PASS' : `NFR-05 FAIL: ${verdict.problems.join(' ')}`);
process.exit(verdict.passed ? 0 : 1);
