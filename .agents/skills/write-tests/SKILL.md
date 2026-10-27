---
name: write-tests
description: How tests are written and run in this repo - NestJS controller specs with a stubbed PrismaService and oRPC call(), React component tests with a QueryClient and a stubbed fetch, Zod schema tests. Use when adding or fixing tests.
---

# Write tests

Everything runs on Vitest. Tests are colocated with the code they cover.

| Package              | File name     | Run only this package                     |
| -------------------- | ------------- | ----------------------------------------- |
| `apps/api`           | `*.spec.ts`   | `pnpm turbo run test --filter=@erp/api`   |
| `apps/web`           | `*.test.tsx`  | `pnpm turbo run test --filter=@erp/web`   |
| `packages/contracts` | `*.test.ts`   | `pnpm turbo run test --filter=@erp/contracts` |

`pnpm test` runs all of them. Inside Docker prefix with `docker compose exec api`. Browser tests are not here: they live in `apps/e2e` and have their own skill, `write-e2e`.

## API controller spec

Build the controller with Nest's testing module, replace `PrismaService` with a stub, and invoke the handler with `call()` from `@orpc/server`. Reference: `apps/api/src/health/health.controller.spec.ts`.

```ts
import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { CustomersController } from './customers.controller.js';

async function createController(prisma: Record<string, unknown>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [CustomersController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return moduleRef.get(CustomersController);
}

describe('CustomersController', () => {
  it('lists customers', async () => {
    const customers = [{ id: '1', name: 'ACME' }];
    const controller = await createController({
      customer: { findMany: vi.fn().mockResolvedValue(customers) },
    });

    await expect(call(controller.list(), undefined)).resolves.toEqual(customers);
  });

  it('creates a customer', async () => {
    const create = vi.fn().mockResolvedValue({ id: '1', name: 'ACME' });
    const controller = await createController({ customer: { create } });

    await expect(call(controller.create(), { name: 'ACME' })).resolves.toMatchObject({ id: '1' });
    expect(create).toHaveBeenCalledWith({ data: { name: 'ACME' } });
  });
});
```

- `call()` runs the contract's input/output validation, so invalid input rejects just like a real request.
- `AuthGuard` doesn't run in controller specs. Pass the user straight into the method: `call(controller.create(user), input)` with `const user: User = { id: 'u1', email: 'admin@erp.local', name: 'Admin', role: 'ADMIN' }`. Guard behaviour (`@Public`, `@Roles`) is covered in `src/auth/auth.guard.spec.ts`.
- Stub only the Prisma methods the handler uses. Don't hit a real database.

## Web component test

Render inside a `QueryClientProvider` built with `createQueryClient()` from `@/lib/query-client`, and stub `fetch` for the API responses. The oRPC client looks up `globalThis.fetch` on every call, so `vi.stubGlobal` works. Reference: `apps/web/src/components/health-status.test.tsx`.

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { CustomerList } from './customer-list';

function renderWithQueryClient(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}

function mockApi(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
}

describe('CustomerList', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders customers from the API', async () => {
    mockApi([{ id: '1', name: 'ACME' }]);

    renderWithQueryClient(<CustomerList />);

    expect(await screen.findByText('ACME')).toBeInTheDocument();
  });
});
```

- Use `findBy*` (async) for anything that appears after the query resolves.
- jsdom and `@testing-library/jest-dom` matchers are set up in `apps/web/src/test/setup.ts`.
- For several endpoints use `mockApi` from `@/test/mock-api`: `mockApi({ 'GET /customers': [...], 'POST /customers': unauthorized() })`. Keys are `'<METHOD> <path without /api>'`; unmocked routes answer 404.
- Components that read the user (`useCurrentUser`) need `'GET /auth/me': { user }` in the mock. For pages with links or redirects, render through `createMemoryRouter` + `RouterProvider`. References: `apps/web/src/routes/login.test.tsx`, `apps/web/src/components/require-auth.test.tsx`.

## Contract schema test

Call `Schema.safeParse(...)` with a valid and an invalid payload and assert `result.success`. Reference: `packages/contracts/src/health.test.ts`.
