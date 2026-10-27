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
        },
      },
    ],
  },
});
