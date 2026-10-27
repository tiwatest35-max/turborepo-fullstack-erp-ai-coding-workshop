# Lesson 10: The Demo line, run by a machine: Playwright on every pull request

**Time:** about 60–75 minutes
**Goal:** turn the one step of the loop that only a human could do, the `Demo:` line, into a browser test that an agent writes from the ticket and that CI runs on every pull request against a real database, as a check that blocks the merge. Then make every future ticket carry its own.

By the end of this lesson you should be able to answer three questions:

1. What can a test that runs the app in a clean environment prove that lesson 8's reviewer can't, and why is its result a GitHub check while the review stays a comment?
2. How does an agent write a browser test that a reviewer can read next to the ticket's `Demo:` line, and what does the skill have to forbid for that to stay true?
3. What changes in lessons 7 to 9's loop when every pull request brings its own demo, and what still doesn't?

Lesson 8 said, about its reviewer: "There is no database and no app in the review job, and the `Demo:` line is still yours." Lesson 9 then made you do that line three times in an hour, with a database reset before each. Every other step of the loop had moved into a file or a job. This one hadn't, because it needs a browser, a running API and a seeded database, and none of those were in CI. This lesson puts them there. The `Demo:` line becomes a Playwright test, the agent writes it from the ticket, and the `CI` workflow gets a second job that runs it on every pull request. Lesson 7's human still reads the diff and still merges. They stop being the only one who has ever clicked through the feature.

---

## 1. The Demo line, run by a machine

![Top to bottom in four rows. First, the ticket, a slate row: a Demo line, log in as the seeded staff user, see the home page with a healthy API, log out. Second, the agent, an amber row: in a fresh session on a branch, with the write-e2e skill, it writes one Playwright test whose title is the Demo line, with accessible locators only and the saved sign-in, runs pnpm e2e on the host, commits and opens a pull request. Third, GitHub Actions, three checks side by side: check, lint typecheck test build, green; e2e, Postgres, build, Chromium, Playwright, green or red and it blocks the merge; AI review, a comment, never a state. Fourth, you: read the review, open the trace if e2e is red, read the diff against the criteria, merge by hand. A red strip across the e2e box says: zero retries, a test is never loosened to pass, red means the Demo line fails. A note across the bottom says: a model gives advice, a test gives a verdict.](images/e2e-demo-line.svg)

Three things can tell you whether a pull request does what its ticket says. Put them next to each other:

| Who checks                 | What they see                                                   | What they can't see                                                              | What their answer is          |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| You, lesson 7 section 5    | The app running, on your branch, with your database             | Whether it works on anyone else's machine, or after the next push                | A tick in a box               |
| The reviewer, lesson 8     | The ticket, the diff, the tests, the PR body, CI status         | The app. It never runs it. The `Demo:` line is a paragraph it checks for clarity | Advice, posted as a comment   |
| The `e2e` job, this lesson | The built app, the built API, a fresh seeded Postgres, Chromium | Whether the test is a good test of the ticket. That is still a reader's job      | A check. Red blocks the merge |

The first two are judgement. The third is a fact: on a machine that has never seen your laptop, with migrations replayed from `main` and the seed and nothing else, a browser did the `Demo:` line, or it didn't. Lesson 8 kept the review out of `ci.yml` because an opinion that can turn CI red teaches people to ignore CI. This job goes into `ci.yml` for the opposite reason. It is not an opinion. It is `pnpm check` with a browser.

What this is **not**: it is not a replacement for the reading. A test proves exactly what it asserts, and whether the assertions are the ticket's criteria is what lesson 8's reviewer and lesson 7's human still check. It also isn't a replacement for the unit tests the `tdd` skill writes at the seams: those run in milliseconds and tell you which function is wrong. This one takes seconds per test and tells you whether the user can do the thing. One per `Demo:` line, and the `Demo:` line as its title, is the whole budget.

---

## 2. Before you start

You need your fork from lesson 9, on `main`, with the lesson 9 pull requests merged or at least no branch checked out:

```bash
git switch main && git pull
git status --short                                   # expect: nothing
gh repo set-default --view                           # expect: <you>/<repo>
gh workflow list                                     # expect: CI and AI review
gh run list --limit 3                                # expect: runs from lessons 7 to 9; empty means Actions is off, lesson 7 section 2
kiro-cli --version                                   # 2.34.0 or later
docker compose ps --services --status running        # expect: at least postgres
```

**Pull this lesson's files from the workshop repository.** Like lesson 8, this lesson's files are on the workshop's `main` and your fork doesn't have them yet: the `apps/e2e` package, the `write-e2e` skill, the `e2e` job in `ci.yml`, a ninth rule in the guard, and one line each in the `AGENTS.md` files and in the `implement-ticket`, `review-pr`, `repo-commands` and `write-tests` skills. Same prompt as lesson 8 section 2, to the `erp` agent in a fresh session on `main`:

```
Bring my fork's main up to date with the workshop repository, the upstream remote. Fetch it and merge
upstream/main into main with a merge commit. Do not rebase and do not force-push. If the merge has
conflicts, stop and show me the files. When the merge is clean, push main to origin and show me
`git log --oneline -3` and `ls apps/e2e .agents/skills`.
```

Expect a conflict in `.github/workflows/ci.yml` only if you edited it yourself; keep `upstream`'s version. Then install what the merge brought and the one thing no earlier lesson needed, a browser:

```bash
pnpm install                                         # or: docker compose run --rm install
pnpm --filter @erp/e2e exec playwright install chromium       # once per machine, ~100 MB into your user cache
```

Note what that command doesn't have: `--with-deps`. On Linux, Playwright can also install the system libraries Chromium needs, with `sudo apt-get`. That half is yours to run if your machine needs it, and section 4 shows the guard refusing it to an agent. On macOS and Windows the download is all there is.

**Run the suite once, before the agent touches it.** The scaffold ships one test, that the login page renders:

```bash
pnpm e2e
```

```
@erp/e2e:e2e: Running 3 tests using 2 workers
@erp/e2e:e2e:   ✓  1 [setup] › tests/auth.setup.ts:7:3 › sign in as admin (100ms)
@erp/e2e:e2e:   ✓  2 [setup] › tests/auth.setup.ts:7:3 › sign in as staff (105ms)
@erp/e2e:e2e:   ✓  3 [chromium] › tests/smoke.e2e.ts:5:1 › the login page renders (732ms)
@erp/e2e:e2e:   3 passed (5.6s)
```

If `docker compose up` is running, those three tests ran against your `api` and `web` containers. If only Postgres is up, as lesson 9 left it, Turborepo built the API and the web app first and Playwright started both itself, which is what CI does. Either way, three green lines before you go on. If the `setup` tests fail with a 401, the database isn't seeded: `pnpm db:seed`.

---

## 3. Ten lines on Playwright

Playwright is Microsoft's browser automation library and test runner. It downloads its own browsers, drives them from Node, and ships a runner with fixtures, projects and reporters. Three of its ideas carry this whole lesson, and the skill in section 5 leans on all three:

- **Locators are accessible.** `page.getByRole('button', { name: 'Sign in' })`, `page.getByLabel('Email')`, `page.getByText('Welcome')`. You find things the way a screen reader does, by role and name, not by CSS class or test ID. A test written this way reads like the `Demo:` line, and it keeps working when someone restyles the button.
- **Everything waits.** `await expect(locator).toBeVisible()` retries until it is, up to a timeout. Clicks wait for the element to be attached, visible, stable and enabled. There is no `sleep` anywhere in a good Playwright test, and the skill forbids the one function that would add it.
- **Every failure leaves a trace.** With `trace: 'retain-on-failure'`, a failed test writes a zip with every action, every network request and a DOM snapshot at each step. You open it with `playwright show-trace` and scrub through what the browser saw. Section 8 is built on this.

Everything else, projects, fixtures, `webServer`, `storageState`, the `github` reporter, is in the config you read in section 4 and in the documentation under Further reading.

---

## 4. What ships: the package, the config, the job, the ninth rule

### The package

`apps/e2e` is a fourth workspace package, `@erp/e2e`, next to the three apps and the shared packages. It has no `build` and no `test`: its scripts are `e2e`, `lint` and `typecheck`, so `pnpm check` lints and typechecks the test code in under a second and never opens a browser, and `pnpm e2e` opens one. Inside:

| File                   | What it is                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.ts` | Chromium only, zero retries, a trace per failure, and the two servers Playwright starts when nothing is listening                            |
| `tests/accounts.ts`    | The two seeded accounts from `seed.ts`, and where each one's saved sign-in lives                                                             |
| `tests/auth.setup.ts`  | A `setup` project that signs in as `admin` and `staff` through the API once per run and saves the cookies to `.auth/<name>.json`, gitignored |
| `tests/smoke.e2e.ts`   | The one test you ran in section 2. The agent writes the next one in section 6                                                                |

Open `playwright.config.ts`. The decisions in it are the ones the room would argue about, so here they are with their reasons:

| Line                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `testMatch: /.*\.e2e\.ts$/`                     | Vitest owns `*.test.ts` and `*.spec.ts` in the apps. A different suffix means the two runners never pick up each other's files                                                                                                                                                                                                                                                                        |
| `retries: 0`                                    | A test that passes on the second try has a bug. Retries hide it, and in CI they hide it from everyone. The trace is the debugging aid, not a rerun                                                                                                                                                                                                                                                    |
| `trace: 'retain-on-failure'`                    | Section 8. A trace on every run would be megabytes per green test for nothing                                                                                                                                                                                                                                                                                                                         |
| One project, `chromium`, after `setup`          | One browser keeps the job under five minutes and the flake surface small. The `dependencies: ['setup']` line is what makes the saved sign-ins exist before the first test                                                                                                                                                                                                                             |
| `webServer`, two entries, `reuseExistingServer` | On your machine with Docker up, ports 3000 and 5173 are taken and Playwright reuses them. With only Postgres, or in CI, it runs `node dist/main.js` and `vite preview` itself. `!isCI` on the reuse flag means CI never reuses anything. The ports are `API_PORT` and `WEB_PORT` from your `.env`, read the way Prisma reads it, so a laptop that moved Docker to other ports moves the tests with it |
| `vite preview`, not `vite dev`                  | The check should exercise what ships: the production bundle. `vite.config.ts` gained a `preview` block with the same port and the same `/api` proxy as `server`, four lines, so the URL is the same in every mode                                                                                                                                                                                     |
| `reporter: github` in CI                        | Failing lines become annotations on the pull request's Files tab. The HTML report is still written and uploaded                                                                                                                                                                                                                                                                                       |

The `e2e` task in `turbo.json` has `dependsOn: ["@erp/api#build", "@erp/web#build"]`, so `pnpm e2e` is also "build the two things the servers need". It never caches, because a browser run against a database isn't a pure function of its inputs.

### The job

Open `.github/workflows/ci.yml`. The `check` job is lesson 7's, untouched. Under it is `e2e`, and it is the first job in this repository with a database:

```yaml
e2e:
  runs-on: ubuntu-latest
  timeout-minutes: 15
  services:
    postgres:
      image: postgres:18-alpine
      env: { POSTGRES_USER: erp, POSTGRES_PASSWORD: erp, POSTGRES_DB: erp }
      ports: ['5432:5432']
      options: --health-cmd "pg_isready -U erp -d erp" ...
  steps:
    - checkout, pnpm, node, pnpm install # the same four as check
    - actions/cache on ~/.cache/ms-playwright # keyed by the Playwright version
    - pnpm --filter @erp/e2e exec playwright install chromium --with-deps
    - pnpm db:deploy && pnpm db:generate && pnpm db:seed # the migrations on this branch, the client, then the two users
    - pnpm e2e
    - upload apps/e2e/playwright-report and test-results, only if: failure()
```

| Part                                  | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In `ci.yml`, not its own workflow     | Lesson 8's reason, inverted. This is a test. It may block a merge, so it belongs with the other tests, under the same trigger, `pull_request` and `push` to `main`                                                                                                                                                                                                                                                                                             |
| A `services` Postgres                 | The same image and credentials as `compose.yaml`, published on `localhost:5432`, which is the default `DATABASE_URL` everywhere in the repository. No env var to set                                                                                                                                                                                                                                                                                           |
| `db:deploy`, `db:generate`, `db:seed` | `migrate deploy` replays the migrations that are on the branch, which is how lesson 9 section 3's drift can't happen here: every job starts from nothing. `generate` is the step a laptop never notices: Prisma 7 does not generate the client on install, `pnpm check` and `pnpm dev` regenerate it through `turbo.json`, but `seed.ts` imports it and runs before either, so the job generates it by name. The seed is the two accounts the tests sign in as |
| `--with-deps` on the runner           | The runner is Ubuntu and needs Chromium's system libraries. The job is not an agent, and the runner is thrown away afterwards. The guard's new rule, below, is for the other place this flag could run                                                                                                                                                                                                                                                         |
| The browser cache                     | ~100 MB per run otherwise. The key is the Playwright version from `node_modules`, so a bump in `package.json` is a fresh download and nothing else is                                                                                                                                                                                                                                                                                                          |
| `timeout-minutes: 15`                 | Install, build, browser and a small suite is about five. A test waiting on a server that never came up is the usual way to spend fifteen                                                                                                                                                                                                                                                                                                                       |
| Upload only on failure                | The trace is for reading a red run. A green run has nothing to say                                                                                                                                                                                                                                                                                                                                                                                             |
| No `continue-on-error`                | The one line that differs from `ai-review.yml`, and the whole point. The job's exit code is the check's state                                                                                                                                                                                                                                                                                                                                                  |

One line of the job to read twice: `pnpm e2e` is the command you ran in section 2. Not a different command, not a CI-only script. If the suite is green on your machine with only Postgres up, it will be green on the runner, because both start the servers the same way from the same built output.

### The ninth rule

Lesson 5 said the guard learns a name when a run shows you one. Lesson 9 taught it `implement:frontier`. This lesson's name is a flag. `playwright install chromium` downloads a browser into your user cache, and an agent may do that. `playwright install chromium --with-deps`, and its sibling `playwright install-deps`, run `sudo apt-get install` on Linux, and an agent may not. Prove it the way lesson 5 does:

```bash
echo '{"tool_input":{"command":"pnpm --filter @erp/e2e exec playwright install chromium"}}'             | node scripts/agent-guard.mjs; echo "exit $?"   # expect: nothing, exit 0
echo '{"tool_input":{"command":"pnpm --filter @erp/e2e exec playwright install chromium --with-deps"}}' | node scripts/agent-guard.mjs; echo "exit $?"   # expect: the message, exit 2
echo '{"tool_input":{"command":"npx playwright install-deps"}}'                                          | node scripts/agent-guard.mjs; echo "exit $?"   # expect: the message, exit 2
```

The message tells the agent what to run instead: the download without the flag, and to leave the system half to a human. Nine rules now, still one short file, still the same file in all three tools.

---

## 5. The skill: `write-e2e`

Open `.agents/skills/write-e2e/SKILL.md`. It is the `write-tests` skill's shape for a browser: where things live, how to run them, the shape of a test, and then four short sections of rules. The rules are the part to read, because each one is there to keep the test readable next to the ticket, and each one forbids something an agent will otherwise do on its second attempt:

| Rule                                                                   | What it stops                                                                                                                                                                           |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The test's title is the `Demo:` line, close to verbatim                | A reviewer reads `gh issue view` and the test file side by side and sees the same sentence. Lesson 8's Criteria check gets a row it can point at                                        |
| Accessible locators only; no CSS, no XPath, no `data-testid`, no `..`  | The second attempt, when `getByRole` didn't match: a CSS class, or a test ID sprinkled into the page. Both make the test about the markup instead of the user. The fix goes in the page |
| Sign in through the saved state; only `login.e2e.ts` fills the form    | Fifteen tests that each log in through the UI, each 700 ms, each a second place the login form can break                                                                                |
| Every test creates its own rows, with a unique suffix; never truncates | Tests that pass alone and fail together, and the `db:reset` lesson 5 refuses to the agent showing up as a `beforeAll`                                                                   |
| No `waitForTimeout`; zero retries; no `fixme` to get to green          | The three ways a flaky test becomes a permanent one                                                                                                                                     |
| When red: open the trace, decide test or feature, fix that one         | Loosening the assertion until it passes. The skill says it in one line: a test is never loosened to pass                                                                                |

The second rule needed a line on the other side too. `apps/web/AGENTS.md` now says every interactive element has a role and a name a locator can find: a `<Label htmlFor>` on inputs, visible text or `aria-label` on buttons, `role="alert"` on errors, real headings. The web rules and the test rules agree, so an agent building a page under one is building it for the other. The side effect, pages that work with a screen reader, is worth exactly this sentence.

Two other skills changed by one line each, and section 9 comes back to both. `implement-ticket` now says that a ticket with a `Demo:` line gets a Playwright test as its last seam and `pnpm e2e` before the last commit. `review-pr` now reads the `e2e` check next to `check`, treats red the way it treats any red CI, a Blocker, and notes a missing `*.e2e.ts` on a ticket that has a `Demo:` line as a Should fix.

---

## 6. The agent's turn: a ticket, a branch, `/implement-ticket`

The scaffold proves the plumbing. The lesson is the agent writing a real `Demo:` line, and the only `Demo:` line every fork has in common is the one feature every fork ships: the login. So the ticket is the one you would have written in lesson 4 if lesson 4 had known about this lesson.

### The ticket

On your fork, as an ordinary issue. It isn't a sub-issue of the spec, so lesson 9's frontier query won't see it, which is right: it is repository work, not a TOR requirement.

```bash
cat > /tmp/ticket.md <<'MD'
## What to build

The login flow, as a Playwright test in `apps/e2e`, so the one Demo: line every fork has runs in CI.

Covers: none; repository work
Demo: log in as the seeded staff user, see the home page with a healthy API and database, log out, land on the login page
Seams: Playwright in apps/e2e only; no api or web changes unless a locator needs an accessible name

## Acceptance criteria

- [ ] `apps/e2e/tests/login.e2e.ts` exists and its first test's title is the Demo: line
- [ ] Signing in as `staff@erp.local` lands on `/`, shows the user's name and role, and both System status badges read ok
- [ ] Logging out lands on `/login`
- [ ] A wrong password shows the `Invalid email or password.` alert and stays on `/login`
- [ ] A test that starts from the saved `admin` sign-in opens `/` without the form
- [ ] `pnpm e2e` is green locally and the `e2e` check is green on the pull request
MD
gh issue create --title "Login and logout as a Playwright test" --body-file /tmp/ticket.md
```

Note the number it prints. The rest of this lesson calls it `#21`; type your own.

### The run

Lesson 7's turn, exactly, because the skill is the same skill. The branch, a fresh window, the command:

```bash
git switch -c ticket/21-login-e2e
kiro-cli chat
```

```
/clear
/implement-ticket #21
```

### What you'll see

1. **The title.** The skill fetches `#21` and states it. Same first line as lesson 7.
2. **The seams.** Instead of a Prisma, API and component seam it names one: a Playwright test in `apps/e2e`. Say yes. Then watch for the next line: it should say it is reading the `write-e2e` skill. The `implement-ticket` bullet from section 5 sends it there. If it starts writing `apps/web/src/routes/login.test.tsx` instead, it read `write-tests` and missed the `Demo:` line; stop it and say so.
3. **Red, then green, in a browser.** It writes `login.e2e.ts`, runs `pnpm --filter @erp/e2e exec playwright test login`, reads the failure and fixes the locator. Two or three rounds. If a round ends with a CSS selector or a `data-testid` added to `login.tsx`, that is the skill's second rule, and the fix is to say "accessible locators only" once. In our run it didn't need saying.
4. **`pnpm e2e`, then `pnpm check`, then the commit, the review, the push, the URL.** Lesson 7's ending.

The file it writes should look like this. Not these exact lines, but this shape, and the title on line 6 is the test:

```ts
import { expect, test } from '@playwright/test';
import { accounts, DEMO_PASSWORD, storageState } from './accounts.js';

test.describe('login and logout', () => {
  test('log in as the seeded staff user, see the home page with a healthy API and database, log out, land on the login page', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(accounts.staff.email);
    await page.getByLabel('Password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(page.getByText(accounts.staff.name)).toBeVisible();
    await expect(page.getByText('STAFF', { exact: true })).toBeVisible();
    await expect(page.getByText('✅ ok')).toHaveCount(2);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a wrong password shows an error and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(accounts.staff.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('signed in through the saved state', () => {
  test.use({ storageState: storageState('admin') });

  test('the home page opens without the form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(accounts.admin.name)).toBeVisible();
  });
});
```

Read it against the ticket before you read the diff. Every criterion is a line you can point at. `{ exact: true }` on `STAFF` is there because the role badge and the word inside the demo-accounts list would otherwise both match, and that is the kind of thing the agent finds on its second red run and the skill tells it how to fix. The whole file runs in about three seconds.

---

## 7. Your turn: the check that ran itself

The agent pushed and opened the pull request. From here the lesson is lesson 7 section 5 and lesson 8 sections 7 and 9, with one more check on the list:

```bash
gh pr view --web
gh pr checks --watch
```

```
check       pass   1m12s   CI
e2e         pass   4m40s   CI
AI review   pass   3m05s   AI review
```

**[Fill from a real run]** the three durations from the Actions tab.

Three things ran and nobody started any of them. `check` is lesson 7's. `AI review` is lesson 8's, and its review now has a line about the `e2e` check in its Evidence or Merge danger paragraph, because the skill told it to read `gh pr checks`. And `e2e` is new: a runner that has never seen your machine installed Chromium, started Postgres, replayed the migrations, seeded two users, built the API and the web app, started both, and did the `Demo:` line. Open the run and read the `pnpm e2e` step. The last lines are the same three-plus-three green lines you saw in section 2, with `login.e2e.ts` added.

Then the human half, which hasn't moved:

1. **Read the AI review.** It should have a Criteria row for each box on `#21`, pointing at lines in `login.e2e.ts`.
2. **Do the `Demo:` line yourself**, once, on the branch, in a browser. Not because the test might be wrong about the app, but because you should see, once, that what you did and what the test did are the same thing. From now on the test does it.
3. **Read the diff against the criteria**, especially the locators. A `getByText` that would match something else on a bigger page is the kind of thing a reviewer catches and a green run doesn't.
4. **Tick the boxes. Hand it to a colleague to merge.** `gh pr merge 21 --squash`, from their terminal, as them. The guard still refuses it to an agent, and nothing in this lesson changed that.

**Make it required.** A check that can be red and still merged is a suggestion. On your fork's Settings, Branches, add a protection rule for `main` with `check` and `e2e` as required status checks. `AI review` stays off the list, for lesson 8's reason. Now the merge button is grey until both are green, for everyone, including you.

---

## 8. When the check is red

The job reports and stops. It never retries, and the skill forbids the agent from making it retry. Everything in this table is a decision, and it is yours.

| What you see                                                                             | What it is                                                                                                                                             | What to do                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e` red, `check` green, a test name in the annotations                                 | The `Demo:` line fails on a clean machine                                                                                                              | Download the `playwright-report` artifact, unzip it, `pnpm --filter @erp/e2e exec playwright show-trace <the zip>`. Scrub to the red step. Then decide: test or feature         |
| The trace shows the page the test expected, with a different word                        | The test is wrong about the page, or the page changed in this PR and the test didn't follow                                                            | Fix the test. In an interactive session on the branch: "the e2e check failed on `<test name>`, here is the trace's last step", and let the agent fix, run `pnpm e2e`, push      |
| The trace shows the feature not doing what the ticket says                               | The feature is wrong. The ticket isn't done, whatever the unit tests say                                                                               | Fix the feature. This is the row the whole lesson exists for                                                                                                                    |
| Green locally, red in CI, the trace shows a 500 or `❌ down`                             | A migration or a seed the branch needs isn't on it, or the API needs an env var CI didn't set                                                          | `git status` for an uncommitted migration; `apps/api/src/config/env.ts` for the variable, and lesson 7's rule: a new one goes in `.env.example`, and here, into the job's `env` |
| Red on one run, green on the next push with no related change                            | A flake. The suite has `retries: 0` so you saw it                                                                                                      | Don't push again to make it green. Find the shared row or the missing `await`. The skill's Data and Flakes sections are the checklist                                           |
| Green on your machine, and `docker compose ps` shows no `web`, but port 5173 answers     | Something else on your machine is listening there, and `reuseExistingServer` tested it instead of this branch                                          | `lsof -nP -i :5173`. Stop it, or set `WEB_PORT` and `API_PORT` in `.env` to free ports and run again. CI never reuses, which is why it is the run that counts                   |
| `e2e` red before `pnpm e2e` ran, `Cannot find module .../src/generated/prisma/client.js` | The seed imported the Prisma client before anything generated it. Prisma 7 does not generate on install, and only the `turbo` tasks after this step do | `pnpm db:generate` belongs between `db:deploy` and `db:seed` in the job. The same error on your machine is the same command                                                     |
| `setup` fails with `401`                                                                 | The seed didn't run or the accounts changed                                                                                                            | `db:seed` is in the job; if someone changed `seed.ts`, `accounts.ts` has to follow                                                                                              |
| The agent's diff adds `data-testid`, a CSS selector or a `sleep`                         | The skill's locator or flake rule didn't hold                                                                                                          | Say the rule once, in the session. If it keeps happening, the wording in `SKILL.md` is what to change                                                                           |
| Red, and the agent says it "loosened the assertion to match"                             | The test was made to pass instead of made right                                                                                                        | Revert that commit. The skill says it in one line; point at the line                                                                                                            |

The first row is the common one, and it is three commands. The trace is the reason this is three commands and not a morning: it shows what the browser saw, step by step, on a machine you will never log in to.

---

## 9. From here on: every ticket brings its Demo

Section 6 was one ticket, by hand, so you could watch. The point of the two one-line changes to the skills in section 5 is that you don't have to again.

**Interactive, lesson 7.** `/implement-ticket #N` on any ticket with a `Demo:` line now ends its seams with a Playwright test and runs `pnpm e2e` before the last commit. The seams prompt will list it; say yes to that seam the way you say yes to the others.

**Unattended, lesson 9.** The `implementer` agent follows the same skill, so the same bullet applies to every pull request `pnpm implement:frontier` opens. Two things about that machine. It needs Chromium once, the command from section 2, run by you, because the implementer may download a browser but the guard stops it from installing the system libraries, and headless every refusal is final. And the loop's preflight requires only Postgres, so when the implementer runs `pnpm e2e`, Playwright builds and starts the API and the web app itself, exactly as in CI. If Chromium is missing, the skill tells the agent to say so in the PR body and push anyway; the `e2e` check still runs on the runner, which is the run that counts. Nothing in `implement-frontier.sh` changed.

**The review, lesson 8.** The reviewer reads `gh pr checks` and now knows there are two. A red `e2e` is a Blocker and the first line of Merge danger. A ticket with a `Demo:` line and no `*.e2e.ts` in the diff is a Should fix. The reviewer still never runs the app; it reads the result of the job that did.

What the human half looks like after this lesson, per pull request: read the review, `/address-review` if it has findings, open the trace if `e2e` is red, read the diff against the criteria, tick the boxes, a colleague merges. The database reset and the manual demo from lesson 9 section 7 are gone from the list, because a clean machine did them. The reading isn't, and lesson 7's rule isn't: a human who isn't the author, before it merges.

---

## 10. Read, don't run yet: two neighbours

**Hosted browser testing.** Playwright has a hosted service of its own, and there are a dozen cloud grids and recording tools that will run your suite on twenty browsers at once or let you build tests by clicking. If your company pays for one, use it for the browser matrix. The job here runs one browser on a free runner, and the thing it runs is a file in the repository, written from the ticket, reviewed in the diff. Keep that part wherever the browsers run.

**The Playwright MCP server.** There is also a way for an agent to drive a browser itself, in the session, through a Model Context Protocol server that exposes click, type and snapshot as tools. With it, the `erp` agent could do the `Demo:` line live, in lesson 7 section 5, and tell you it worked. Lesson 3's agent has `includeMcpJson: false`, so it can't, and this lesson keeps it that way, for one reason: an agent clicking through once is lesson 7's human demo with a different person at the mouse. It proves the feature worked once, in that session, and leaves nothing behind. A committed test proves it on every push, for every reviewer, forever, and a reviewer can read it. The MCP server is a good way to **write** a test, by watching the page while you write it, and `playwright test --ui` does most of that for a person. Know it exists, and keep the proof in a file.

---

## 11. Check that it worked

Read `21` as your ticket number.

- `ls apps/e2e/tests` shows `accounts.ts`, `auth.setup.ts`, `smoke.e2e.ts` and `login.e2e.ts`. `ls -la .kiro/skills/write-e2e .claude/skills/write-e2e` shows two symlinks into `.agents/skills/write-e2e`.
- `pnpm e2e` on the branch prints six green lines in under ten seconds, with only Postgres running or with the full stack running.
- `echo '{"tool_input":{"command":"npx playwright install --with-deps"}}' | node scripts/agent-guard.mjs` prints the system package message and exits 2. The same command without `--with-deps` prints nothing and exits 0.
- `gh pr checks 21` lists `check`, `e2e` and `AI review`, the first two from the `CI` workflow, all green. The `e2e` run's log shows a `postgres` service, a `Migrate, generate and seed` step, and the `pnpm e2e` step ending in the same green lines.
- The review from `github-actions` has a Criteria row per box on `#21`, each pointing at a line in `login.e2e.ts`, and mentions the `e2e` check.
- The PR's diff touches `apps/e2e/tests/login.e2e.ts` and nothing under `apps/web`, `apps/api`, `.github`, `.agents` or `scripts`.
- `git grep -n 'data-testid' apps/web/src` prints nothing. `git grep -n 'waitForTimeout\|locator(' apps/e2e/tests` prints nothing.
- On github.com, Settings, Branches, the rule for `main` requires `check` and `e2e`, and not `AI review`.
- Kiro's `/context show` in a fresh session lists `write-e2e` next to `write-tests`.

---

## Summary

- **The `Demo:` line was the last step only a human could do**, because it needs a browser, an API and a seeded database. Now CI has all three, and the line is a test an agent writes from the ticket.
- **A test is a check; a review is a comment.** Lesson 8 kept the reviewer out of `ci.yml` because an opinion must not turn CI red. This job goes in because it isn't one. Red means the `Demo:` line failed on a clean machine, and the merge button goes grey.
- **The skill forbids what an agent would do on its second attempt.** CSS and test IDs, logging in through the form everywhere, shared rows, sleeps and retries, loosening an assertion to pass. Each rule is one line, and each one keeps the test readable next to the ticket.
- **The web rules and the test rules agree.** Every interactive element has an accessible name, so a page built under `AGENTS.md` is a page a locator can find. Screen readers get the same thing for free.
- **The guard learned a flag.** `playwright install` is fine; `--with-deps` and `install-deps` run `sudo apt-get` and are a human's, or the runner's. Nine rules, one file.
- **The loop shrank by two steps and kept the reading.** No reset, no manual demo per pull request. Still a human who isn't the author, still the diff against the criteria, still a colleague's merge.
- **One test per `Demo:` line is the budget.** The unit tests at the seams still find the broken function in milliseconds. This finds whether the user can do the thing, in seconds, once per ticket.

---

## Optional: try it later

**The second turn, on your own ticket.** Pick one ticket merged on your fork in lessons 7 to 9 that has a `Demo:` line and no `*.e2e.ts`. Open a ticket like section 6's for it, `/implement-ticket`, and read the test the agent writes against the original ticket's `Demo:` line. Where they differ, one of them is wrong, and the trace will tell you which.

**Watch it write.** `pnpm --filter @erp/e2e exec playwright test --ui` on the branch while the agent is iterating in another terminal. You see each run as it happens and can click into any step.

**Run the pass.** After your colleague has merged `#21`, `pnpm implement:frontier --max 1` on a ticket with a `Demo:` line. Read `.ai-runs/<n>.log` for the `write-e2e` read and the `pnpm e2e` run, and then read the pull request's `e2e` check. Nobody started either.

**A second browser.** Add `{ name: 'firefox', use: { ...devices['Desktop Firefox'] }, dependencies: ['setup'] }` to the projects, install it, and run. Then decide whether the extra minutes per pull request buy anything for an internal ERP, and take it out or leave it.

---

## Appendix A: the same turn in Claude Code and Codex

The skill is one file, read through two symlinks. The package, the config and the job are harness-neutral: nothing in `apps/e2e` or `ci.yml` knows which agent wrote the test.

| Step            | Kiro CLI                                                                              | Claude Code                                      | Codex                                                               |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| The skill       | `.kiro/skills/write-e2e`, listed by `/context show`                                   | `.claude/skills/write-e2e`, listed by `/context` | `.agents/skills/write-e2e`, through `agents/openai.yaml`            |
| The run         | `/clear`, `/implement-ticket #21`, yes to the seam                                    | Same                                             | `$implement-ticket #21`, or "use the implement-ticket skill on #21" |
| The guard       | The hook in `erp.json`, section 4's ninth rule                                        | `.claude/settings.json`, same script             | Lesson 5 Appendix A's hook, same script                             |
| Headless        | `kiro-cli chat --v3 --no-interactive --agent implementer "/implement-unattended #21"` | `claude -p "/implement-ticket #21"`              | `codex exec "use the implement-ticket skill on #21"`                |
| Red `e2e` check | Interactive session on the branch, paste the failing test and the trace's last step   | Same                                             | Same                                                                |
| Review findings | `/address-review #<PR>` in the same interactive session, lesson 8 section 9           | Same                                             | `$address-review #<PR>`                                             |

---

## Further reading

- Playwright, [Locators](https://playwright.dev/docs/locators), [Auto-waiting](https://playwright.dev/docs/actionability), [Trace viewer](https://playwright.dev/docs/trace-viewer): the three ideas in section 3.
- Playwright, [Authentication](https://playwright.dev/docs/auth) and [Projects](https://playwright.dev/docs/test-projects): the `setup` project and `storageState` in `auth.setup.ts`.
- Playwright, [Web server](https://playwright.dev/docs/test-webserver) and [Continuous integration](https://playwright.dev/docs/ci): `reuseExistingServer`, the `github` reporter, and the browser cache.
- Playwright, [Best practices](https://playwright.dev/docs/best-practices): where the skill's locator and isolation rules come from.
- GitHub, [Creating PostgreSQL service containers](https://docs.github.com/en/actions/use-cases-and-examples/using-containerized-services/creating-postgresql-service-containers) and [Required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging): the `services` block and section 7's last step.
- Vite, [Preview options](https://vite.dev/config/preview-options): the four lines added to `vite.config.ts`.
- Playwright, [Playwright MCP](https://github.com/microsoft/playwright-mcp): section 10's second neighbour.
- Fowler, [Test Pyramid](https://martinfowler.com/bliki/TestPyramid.html): why one browser test per `Demo:` line and not one per criterion.
