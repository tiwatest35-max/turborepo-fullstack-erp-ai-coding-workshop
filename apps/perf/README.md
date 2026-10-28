# @erp/perf

The NFR-05 load test. It runs on demand with `pnpm perf` and is not part of `pnpm check` or `pnpm e2e`.

NFR-05: the product-search and stock-view APIs answer in 2 seconds or less at p95 for 10 concurrent users over a continuous 5 minutes, on 1,000 products and 10,000 stock movements. CSV exports are excluded.

## Run it

Postgres must be up (`docker compose up -d --wait postgres`). From the repo root:

```bash
pnpm perf
```

It builds the API, then:

1. drops and recreates the `erp_perf` database (never `erp`) and applies the migrations,
2. loads the TOR starting data and tops it up to exactly 1,000 products and 10,000 movements, with balances equal to the sum of their movements,
3. starts the built API on port 3100 against that database and signs in as `manager01@erp.local`,
4. runs 10 virtual users for 5 minutes. Each sends one request, reads the whole answer, and sends the next at once, alternating `GET /api/products?search=...` and `GET /api/stock?...` with varied search terms, stores, pages and the low-stock filter,
5. writes `docs/evidence/nfr-05/<timestamp>.md` and `.json`, and exits 1 unless NFR-05 is met.

A run fails when p95 is above 2000 ms on either API, when any request fails, when fewer than 10 users or less than 5 minutes ran, or when the dataset is not exactly 1,000 and 10,000.

## Options

The defaults are the requirement. A shorter run is useful to try the harness and is always reported as FAIL.

| Variable                | Default                | Meaning                                          |
| ----------------------- | ---------------------- | ------------------------------------------------ |
| `PERF_DURATION_SECONDS` | `300`                  | How long the users send requests                 |
| `PERF_VIRTUAL_USERS`    | `10`                   | Concurrent users                                 |
| `PERF_API_PORT`         | `3100`                 | Port of the API the harness starts               |
| `PERF_DATABASE`         | `erp_perf`             | Database to recreate. Must start with `erp_perf` |
| `PERF_RESULTS_DIR`      | `docs/evidence/nfr-05` | Where the report is written                      |

## What the unit tests cover

`pnpm turbo run test --filter=@erp/perf` checks the pass/fail rule (`verdict.ts`) and the generated ledger (`movement-plan.ts`). They do not drive load. Only `pnpm perf` does.
