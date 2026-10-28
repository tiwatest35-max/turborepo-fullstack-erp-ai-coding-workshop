import { defineConfig } from 'vitest/config';

const exclude = ['**/node_modules/**', '**/dist/**', '**/.dev/**'];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: [...exclude, 'src/**/*.int.spec.ts'],
          // These mock the database and should be instant. A small margin keeps them from
          // timing out if anything else is briefly contending for the event loop.
          testTimeout: 15_000,
          // Run in its own group, before the heavy integration project, so the two never
          // share a worker pool (see the integration project's maxWorkers).
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Needs the Postgres from compose.yaml (or CI's service container): `docker compose up -d postgres`.
        // See src/test/database.ts for how each worker gets its own database.
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.spec.ts'],
          exclude,
          globalSetup: ['src/test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Each file resets a real Postgres before every scenario. Running these in a later
          // group means they never share a worker pool with the unit project, which otherwise
          // gets starved and times out on a many-core machine.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
