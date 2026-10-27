---
name: repo-commands
description: Running scripts in this monorepo - Docker vs host, database migrations/seed/reset, running one package with --filter, adding dependencies, Prisma generate and node_modules gotchas. Use before running db, install, or turbo commands.
---

# Repo commands

All scripts are defined in the root `package.json`. Run them from the repo root.

## Docker or host?

The stack usually runs in Docker (`pnpm docker:up` / `docker compose up`, services `postgres`, `api`, `web`). Then run scripts **inside the api container**:

```bash
docker compose exec api pnpm db:migrate --name add_customers
docker compose exec api pnpm check
```

If Node 24 + pnpm are installed on the host, the same commands work directly (`pnpm check`). `pnpm dev:local` runs only Postgres in Docker and the apps on the host. Don't run it alongside `docker compose up` (same ports).

Check what is running first: `docker compose ps`.

## Common commands

| Task                              | Command                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| Full check (lint, typecheck, test, build) | `pnpm check`                                             |
| Format                            | `pnpm format`                                                    |
| One task in one package           | `pnpm turbo run test --filter=@erp/api`                          |
| New migration after schema change | `pnpm db:migrate --name <change>`                                |
| Regenerate the Prisma client      | `pnpm db:generate`                                               |
| Seed                              | `pnpm db:seed`                                                   |
| Wipe + re-migrate + seed          | `pnpm db:reset`                                                  |
| Delete containers + all volumes (db, pnpm store) | `pnpm docker:clean` (all clones share one `erp-workshop` volume) |
| Prisma Studio                     | `docker compose --profile tools up -d studio` (localhost:5555)   |
| Add a dependency                  | `pnpm add <pkg> --filter @erp/web` (run in **one** place only)   |
| Browser tests (the `Demo:` lines) | `pnpm e2e` on the **host**; see the `write-e2e` skill            |
| Last Playwright report or a trace | `pnpm --filter @erp/e2e exec playwright show-report`, `... show-trace <zip>` |

## Gotchas

- `node_modules` is a bind mount shared by host and containers. Install in one place only; never run `pnpm install` on both sides.
- Prisma 7: `migrate dev` does not run `generate`. `turbo` tasks depend on `db:generate`, so `pnpm dev` / `pnpm check` regenerate it. Run `pnpm db:generate` manually only when types look stale.
- The generated client lives in `packages/database/src/generated` (gitignored). If it is missing, run `pnpm db:generate`.
- Shared packages (`@erp/contracts`, `@erp/database`) are consumed from `dist/`. `turbo dev` rebuilds them in watch mode. If an app sees stale types outside `dev`, run `pnpm turbo run build --filter='./packages/*'`.
- Dependency errors after `git pull`: `docker compose run --rm install`.
- Env vars: defaults work without a `.env`. `apps/api/src/config/env.ts` validates them on startup. A new variable also goes into `.env.example`, and into `globalPassThroughEnv` in `turbo.json` if a turbo task needs it.
- URLs: web `http://localhost:5173`, API `http://localhost:3000/api`, Swagger docs `/api/docs`.
- Playwright runs on the host, never in a container: the dev image has no browser. Once per machine: `pnpm --filter @erp/e2e exec playwright install chromium` (the download only; `--with-deps` is a human's command). With `docker compose up` running, `pnpm e2e` reuses the `api` and `web` containers; with only Postgres up, it builds and starts the API and `vite preview` itself.
