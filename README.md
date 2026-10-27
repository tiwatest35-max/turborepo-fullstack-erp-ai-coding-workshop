# ERP Workshop: Full-stack TypeScript Monorepo

The starter repository for the on-site **AI-assisted coding workshop**. We will build an ERP together on top of this scaffold:

- **Frontend**: [Vite](https://vite.dev) + React 19, React Router, TanStack Query, Tailwind CSS v4, [shadcn/ui](https://ui.shadcn.com)
- **Backend**: [NestJS](https://nestjs.com) 12
- **Shared API contract**: [oRPC](https://orpc.dev) + [Zod](https://zod.dev). One typed contract used by both apps.
- **Database**: PostgreSQL 18 + [Prisma](https://www.prisma.io) 7
- **Monorepo**: [Turborepo](https://turborepo.dev) + [pnpm](https://pnpm.io) workspaces
- **Dev environment**: Docker Compose. **You only need Docker installed.**

No ERP features yet. This is the clean starting point. Sign-in is already built in, so the workshop can go straight to the ERP.

The lessons that go with the workshop are in [`lessons/`](lessons/README.md). Start with [Lesson 1: Monorepos, Turborepo, and AI coding](lessons/01-monorepo-and-turborepo.md), then [Lesson 2: Context engineering: AGENTS.md and skills](lessons/02-context-engineering-agents-md-and-skills.md) [Lesson 3: Start clean: reset your agent, lock the project settings, switch off memory](lessons/03-clean-agent-setup.md), [Lesson 4: From a TOR to tickets: grill, spec, tickets](lessons/04-from-tor-to-tickets.md), [Lesson 5: Hooks: a guard between the agent and the shell](lessons/05-hooks-guard-the-shell.md), [Lesson 6: Subagents: fresh windows that work for the main one](lessons/06-subagents-fresh-windows.md), [Lesson 7: From tickets to code: one turn of the implement loop](lessons/07-from-tickets-to-code.md), [Lesson 8: An AI reviewer on every pull request: Kiro in GitHub Actions](lessons/08-ai-reviews-the-pull-request.md), [Lesson 9: The loop without the typing: a headless implementer over the frontier](lessons/09-the-loop-without-the-typing.md), [Lesson 10: The Demo line, run by a machine: Playwright on every pull request](lessons/10-the-demo-line-run-by-a-machine.md), and [Lesson 11: One server, on purpose: planning into Jira through MCP](lessons/11-one-server-on-purpose-jira-mcp.md).

---

## 1. Before the workshop (please do this at home)

Venue Wi-Fi is shared by everyone, so download the heavy stuff beforehand.

1. Install:
   - [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose on Linux)
   - [Git](https://git-scm.com/)
   - An editor: [VS Code](https://code.visualstudio.com/), Cursor, Kiro, WebStorm, ...
   - [GitHub CLI](https://cli.github.com/) (`gh`), signed in with `gh auth login`. Lesson 4 uses it to fork the repo and publish issues.
2. **Windows only:** install [WSL 2](https://learn.microsoft.com/windows/wsl/install) and clone the repo **inside the WSL filesystem** (e.g. `~/code`, not `C:\...` / `/mnt/c/...`). File watching and performance are much better there.
3. Fork this repository on GitHub, then clone **your fork** and pre-download everything. Lesson 4 publishes GitHub issues into your fork. (Already cloned the original? Lesson 4 shows how to fork afterwards.) While you are on github.com, open your fork's **Actions** tab and press the button that enables workflows: GitHub switches them off on every fork, and lessons 7 to 10 need CI and the AI review running on yours.

   ```bash
   git clone <your-fork-url> erp-workshop
   cd erp-workshop
   docker compose build             # dev image (Node 24 + pnpm)
   docker compose pull postgres     # database image
   docker compose run --rm install  # installs node_modules + builds shared packages
   ```

4. Start it once to check everything works (see below), then `docker compose down`.

## 2. Start the stack

```bash
docker compose up
```

The first start takes a few minutes. When the logs settle:

| What                 | URL                                 |
| -------------------- | ----------------------------------- |
| Web app              | http://localhost:5173               |
| API                  | http://localhost:3000/api           |
| API docs (Swagger)   | http://localhost:3000/api/docs      |
| Postgres (for tools) | `localhost:5432` user/pass/db `erp` |

Sign in with one of the demo accounts (they are also listed on the login page):

| Email             | Password   | Role    |
| ----------------- | ---------- | ------- |
| `admin@erp.local` | `password` | `ADMIN` |
| `staff@erp.local` | `password` | `STAFF` |

The home page then shows a **System status** card. **API ✅ / Database ✅** means the full chain works: React → typed client → Vite proxy → NestJS → Prisma → Postgres.

Edit any file and it reloads automatically: React (HMR), NestJS (restart), and the shared packages (rebuild).

Stop with `Ctrl+C`, or `docker compose down`. Add `-v` to also delete the database.

### Signing in

Auth is deliberately minimal and only meant for the workshop. There is no sign-up or password reset: users come from `packages/database/prisma/seed.ts`, which runs every time the api starts.

- `POST /api/auth/login` checks the password and sets an httpOnly cookie holding the user id, signed with `AUTH_SECRET` and valid for 7 days. `auth.logout` clears it, and `auth.me` returns the current user.
- Every API route requires a signed-in user unless it is marked `@Public()`. `@Roles('ADMIN')` limits a route to certain roles (`apps/api/src/auth`).
- In the web app, every page under `RequireAuth` redirects to `/login` when nobody is signed in or any request returns 401 (`apps/web/src/lib/auth.ts`).

### Browse the database

```bash
docker compose --profile tools up -d studio   # Prisma Studio on http://localhost:5555
```

## 3. Everyday commands

Run commands **inside the api container** so you don't need Node on your machine:

```bash
docker compose exec api pnpm db:migrate --name add_customers   # after editing schema.prisma
docker compose exec api pnpm db:seed
docker compose exec api pnpm db:reset                          # wipe + re-migrate + seed
docker compose exec api pnpm check                             # lint + typecheck + test + build
docker compose exec api pnpm add <pkg> --filter @erp/web       # add a dependency
```

> Already have Node 24 + pnpm? You can run the same commands directly (`pnpm check`, `pnpm db:migrate ...`), and even run the apps on your machine with `pnpm dev:local`. It starts only Postgres in Docker, applies migrations, then runs `pnpm dev`. Don't run it at the same time as `docker compose up`, because they use the same ports (`docker compose stop api web` first).

## 4. How the project is organised

```
apps/
  web/          @erp/web        React app (talks only to /api, proxied by Vite)
  api/          @erp/api        NestJS app (implements the contract)
packages/
  contracts/    @erp/contracts  API contract: routes + Zod schemas (shared!)
  database/     @erp/database   Prisma schema, migrations, seed, client
  typescript-config/            shared tsconfig
  eslint-config/                shared ESLint config
compose.yaml                    local dev stack
turbo.json                      task pipeline (build → dev/test/lint/typecheck)
```

**The contract is the heart of the monorepo.** `packages/contracts` describes every endpoint (method, path, input, output) with Zod:

- `apps/api` implements it: `@Implement(contract.health.check)`
- `apps/web` calls it with a fully typed client: `useQuery(orpc.health.check.queryOptions())`

Change the contract and TypeScript immediately shows you what to fix on both sides.

See [AGENTS.md](AGENTS.md) for the repo conventions and `apps/api/AGENTS.md` / `apps/web/AGENTS.md` for the rules specific to each app. The step-by-step "add a feature" workflow, test recipes and command cheat-sheet live as skills in `.agents/skills/`. (Your AI assistant reads all of them too.)

## 5. Troubleshooting

| Problem                                        | Fix                                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port is already allocated`                    | Something else uses the port. Copy `.env.example` to `.env` and change `WEB_PORT` / `API_PORT` / `POSTGRES_PORT`.                                                |
| Changes are not picked up                      | Windows: make sure the repo is inside WSL, not under `/mnt/c`. Then `docker compose restart api web`.                                                            |
| Editor shows red squiggles everywhere          | `node_modules` is missing: `docker compose run --rm install`, then restart the TS server in your editor.                                                         |
| Weird dependency errors after `git pull`       | `docker compose run --rm install`                                                                                                                                |
| Can't sign in with the demo accounts           | Re-create them: `docker compose exec api pnpm db:seed`                                                                                                           |
| Seed fails with `invalid input value for enum` | The database volume is shared by every clone of this repo and holds another checkout's migrations. `pnpm docker:clean` (deletes the database), then start again. |
| Start completely fresh                         | `pnpm docker:clean`, delete `node_modules`, then `docker compose up`                                                                                             |

## Optional: Dev Container

If you use VS Code / Cursor with the Dev Containers extension, choose **"Reopen in Container"**. You get a shell inside the dev image (Node, pnpm, Postgres already wired) and can run `pnpm dev` there.
