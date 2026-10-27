# AGENTS.md

Rules for AI coding agents working in this repository. Humans: see [README.md](README.md).

## What this is

A teaching monorepo for a full-stack ERP (Turborepo + pnpm workspaces, runs in Docker).

| Path                 | Package          | What                                                                   |
| -------------------- | ---------------- | ---------------------------------------------------------------------- |
| `apps/web`           | `@erp/web`       | Vite + React 19, React Router, TanStack Query, Tailwind v4, shadcn     |
| `apps/api`           | `@erp/api`       | NestJS 12 (native ESM), implements the oRPC contract, Prisma           |
| `packages/contracts` | `@erp/contracts` | oRPC routes + Zod schemas. Single source of truth for the API          |
| `packages/database`  | `@erp/database`  | Prisma 7 schema, migrations, seed, generated client                    |
| `apps/e2e`           | `@erp/e2e`       | Playwright browser tests, one per ticket `Demo:` line, run on every PR |

`packages/typescript-config` and `packages/eslint-config` hold shared configs.

Each app has its own rules: [`apps/api/AGENTS.md`](apps/api/AGENTS.md), [`apps/web/AGENTS.md`](apps/web/AGENTS.md). Read the file for every app you touch.

## Rules

- **Contract-first.** The API shape lives in `packages/contracts`. The api implements it, the web calls it through the typed client, and both derive types with `z.infer`. Never hand-write request/response types or validation in the apps.
- **ESM everywhere.** Relative imports in `apps/api` and `packages/*` need the `.js` extension. `apps/web` uses the `@/` alias for `src/` with no extension.
- **Env vars** are validated in `apps/api/src/config/env.ts`. New ones also go into `.env.example`.
- **Shared packages** are built to `dist/`; apps import the built output.
- **Before finishing:** `pnpm check` (lint, typecheck, test, build) and `pnpm format`, from the repo root. `pnpm e2e` as well when the change touches a `Demo:` line, a page, or `apps/e2e`.

## Skills

Load the matching skill instead of guessing the details:

- `add-feature`: end-to-end recipe with templates (Prisma model → contract → Nest module → React → tests).
- `write-tests`: how api specs, web component tests, and contract schema tests are written and run.
- `write-e2e`: how the Playwright tests in `apps/e2e` are written and run, one per `Demo:` line, and what to do when the `e2e` check is red.
- `repo-commands`: Docker vs host, db migrations/seed/reset, `--filter`, dependencies, Prisma and `node_modules` gotchas.
