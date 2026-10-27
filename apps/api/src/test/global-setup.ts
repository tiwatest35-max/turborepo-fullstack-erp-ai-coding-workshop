import { adminDatabaseUrl, createMigratedTemplate, dropTestDatabases } from './database.js';

/**
 * Runs once per `vitest run`, before any integration file: removes databases a crashed run
 * left behind and builds the migrated template that every worker clones.
 */
export async function setup() {
  try {
    await dropTestDatabases();
  } catch (cause) {
    throw new Error(
      `The integration tests need Postgres, and ${new URL(adminDatabaseUrl()).host} did not answer. ` +
        'Start it with `docker compose up -d --wait postgres` (or set DATABASE_URL to a running server). ' +
        'In CI the job needs a postgres service container, as the e2e job has.',
      { cause },
    );
  }
  await createMigratedTemplate();
}

export async function teardown() {
  await dropTestDatabases();
}
