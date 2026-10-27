# AGENTS.md (apps/web)

Rules for `@erp/web` (Vite, React 19, React Router, TanStack Query, Tailwind v4, shadcn/ui). The [root AGENTS.md](../../AGENTS.md) still applies.

- **Talk to the API only through the typed client** `orpc` from `@/lib/orpc`. Read: `useQuery(orpc.<feature>.<route>.queryOptions({ input }))`. Write: `useMutation(orpc.<feature>.<route>.mutationOptions())`. No hand-written `fetch` calls or response types. Reference: `src/components/health-status.tsx`.
- **Requests go to `/api` on the same origin** (Vite proxies to NestJS). Don't hard-code the API URL.
- **Layout**: routes in `src/router.tsx`, pages in `src/routes/`, feature components in `src/components/`, shadcn/ui primitives in `src/components/ui` (generated, don't hand-edit).
- **Auth**: pages that need a user go under the `RequireAuth` route in `src/router.tsx`, which is the default for everything inside `RootLayout`. Get the user with `useCurrentUser()` from `@/lib/auth`. Don't handle 401s in components: the query client already redirects to `/login`.
- **Styling** with Tailwind utilities; merge class names with `cn()` from `@/lib/utils`.
- **Accessible names.** Every interactive element has a role and a name a Playwright locator can find without a `data-testid`: inputs get a `<Label htmlFor>`, buttons have visible text or an `aria-label`, error messages use `role="alert"`, page headings are `<h1>`/`<h2>`. The browser tests in `apps/e2e` rely on this; see the `write-e2e` skill.
- Tests are colocated `*.test.tsx` files. See the `write-tests` skill.
