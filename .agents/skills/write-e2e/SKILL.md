---
name: write-e2e
description: How browser tests are written and run in this repo - Playwright in apps/e2e, one test per ticket Demo: line, accessible locators only, saved sign-ins for the two seeded accounts, tests that create their own data. Use when a ticket has a Demo: line, when adding or fixing a *.e2e.ts file, or when the e2e check on a pull request is red.
---

# Write e2e tests

A `Demo:` line on a ticket says what a person would show when the ticket is done. A Playwright test in `apps/e2e` is that line, run by CI on every pull request. One ticket, one `*.e2e.ts` file, the `Demo:` line as its first test.

| What                   | Where                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| Tests                  | `apps/e2e/tests/<feature>.e2e.ts`                                      |
| Config                 | `apps/e2e/playwright.config.ts` (Chromium only, zero retries, traces)  |
| Seeded accounts        | `apps/e2e/tests/accounts.ts`                                           |
| Saved sign-ins         | `apps/e2e/tests/auth.setup.ts` writes `apps/e2e/.auth/<name>.json`     |
| The check on a PR      | The `e2e` job in `.github/workflows/ci.yml`                            |

## Run

```bash
pnpm e2e                                                  # from the repo root, on the host
pnpm --filter @erp/e2e exec playwright test login         # one file
pnpm --filter @erp/e2e exec playwright test --ui          # watch it run
pnpm --filter @erp/e2e exec playwright show-report        # the last HTML report
```

Playwright runs on your machine, not in the containers. Once per machine: `pnpm --filter @erp/e2e exec playwright install chromium`. Never add `--with-deps`: the guard refuses it, because it installs system packages with sudo. If Chromium is missing and you cannot install it, say so in the PR body and let CI run the suite.

With `docker compose up` running, the suite reuses the `api` and `web` containers. With only Postgres running, `pnpm e2e` builds the API and the web app and Playwright starts both (`node dist/main.js` and `vite preview`). The ports are `API_PORT` and `WEB_PORT` from the repo-root `.env`, default 3000 and 5173, the same as `compose.yaml`. In CI it is always the second form, against a fresh seeded database, and the `e2e` check turns red when a test fails. Red means the `Demo:` line fails; it is never retried.

## The shape of a test

```ts
import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('products', () => {
  test.use({ storageState: storageState('admin') });

  test('create SKU001 on the products page, try again, see the rejection', async ({ page }) => {
    const sku = `SKU-${Date.now()}`; // this test's rows, nobody else's

    await page.goto('/products');
    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Name').fill('Workshop chair');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: new RegExp(sku) })).toBeVisible();

    await page.getByRole('button', { name: 'New product' }).click();
    await page.getByLabel('SKU').fill(sku);
    await page.getByLabel('Name').fill('Another chair');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toContainText('already exists');
  });
});
```

- **Name the test with the `Demo:` line**, close to verbatim. A reviewer reads the ticket and the test title side by side.
- **Start from a URL**, `page.goto('/...')`, with the saved sign-in. Only `login.e2e.ts` fills the login form.
- **Assert what the user sees**, with `expect(locator)` and `toHaveURL`. Playwright waits for the condition; never add `waitForTimeout`.
- **Relative imports end in `.js`**, as everywhere outside `apps/web`.

## Locators

Only the accessible ones: `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`. No CSS, no XPath, no `data-testid`, no `.locator('..')` to climb the tree. If the page has no accessible way to reach an element, fix the page (`apps/web/AGENTS.md` says every interactive element needs a name), not the test. Use `{ exact: true }` when a short text such as a role badge could match twice.

## Signing in

`auth.setup.ts` signs in as `admin` and `staff` once per run and saves the cookies. A test picks one with `test.use({ storageState: storageState('staff') })` at the top of its `describe`. A test with no `test.use` starts signed out, which is what the login tests want.

## Data

- Every test creates the rows it needs, through the UI or the API (`request.post('/api/...')`), with a unique suffix in any unique field: `Date.now()` or `test.info().testId`.
- Never truncate a table, never run `db:reset`, never depend on rows another test created. Tests run in any order and in parallel against one database.
- The only rows a test may assume exist are the two seeded users in `accounts.ts`.

## Flakes

`retries` is 0 in the config, in CI too. A test that passes on the second run has a bug: a missing `await`, an assertion on text that is still loading, data shared with another test. Fix the cause. Do not add a retry, a sleep, or `test.fixme`.

## When the `e2e` check is red

1. Open the failed run on GitHub. The `github` reporter annotates the failing line; the `playwright-report` artifact has the HTML report and one trace per failure.
2. Unzip the artifact and open the trace: `pnpm --filter @erp/e2e exec playwright show-trace path/to/trace.zip`. Every click, request and DOM snapshot is in it.
3. Decide which is wrong, the test or the feature, and fix that one. If the feature is wrong, the ticket was not done. A test is never loosened to pass.
