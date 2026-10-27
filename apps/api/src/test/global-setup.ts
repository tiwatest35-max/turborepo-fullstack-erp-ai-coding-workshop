import { createMigratedTemplate, dropTestDatabases } from './database.js';

/**
 * Runs once per `vitest run`, before any integration file: removes databases a crashed run
 * left behind and builds the migrated template that every worker clones.
 */
export async function setup() {
  await dropTestDatabases();
  await createMigratedTemplate();
}

export async function teardown() {
  await dropTestDatabases();
}
