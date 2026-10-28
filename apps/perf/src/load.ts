import { DEMO_PASSWORD } from '@erp/database';
import { apiBaseUrl } from './api-process.js';
import type { DatasetSummary } from './dataset.js';
import { NFR05, type EndpointName, type EndpointResult } from './verdict.js';

/**
 * The load: N virtual users, each a closed loop that sends one request, reads the whole answer,
 * and sends the next straight away (no think time), until the deadline. That is a harsher
 * pattern than the same number of people clicking around. Each request is timed from just before
 * it is sent until its body has been read and checked, and filed under the API it called.
 */

const REQUEST_TIMEOUT_MS = 30_000;

export type LoadOutcome = {
  endpoints: Record<EndpointName, EndpointResult>;
  /** Wall-clock time from the first request sent to the last answer received. */
  durationMs: number;
  virtualUsers: number;
};

/** The requests a user makes, per API. The terms are taken from the seeded data. */
export function scenariosFor(dataset: DatasetSummary): Record<EndpointName, (n: number) => string> {
  const sku = (n: number) => dataset.skus[n % dataset.skus.length]!;
  const word = (n: number) => dataset.words[n % dataset.words.length]!;
  const store = (n: number) => dataset.stores[n % dataset.stores.length]!.id;
  const q = (params: Record<string, string | number>) =>
    new URLSearchParams(
      Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
    ).toString();

  const productSearch = [
    (n: number) => `/products?${q({ search: sku(n) })}`,
    (n: number) => `/products?${q({ search: word(n), page: 1 + (n % 5), pageSize: 20 })}`,
    (n: number) => `/products?${q({ search: word(n), status: 'active', pageSize: 50 })}`,
    (n: number) => `/products?${q({ page: 1 + (n % 20), pageSize: 50 })}`,
  ];
  const stockView = [
    (n: number) => `/stock?${q({ search: sku(n) })}`,
    (n: number) => `/stock?${q({ search: word(n), storeId: store(n), pageSize: 20 })}`,
    (n: number) => `/stock?${q({ lowStockOnly: 'true', page: 1 + (n % 5), pageSize: 20 })}`,
    (n: number) => `/stock?${q({ storeId: store(n), page: 1 + (n % 20), pageSize: 50 })}`,
  ];
  return {
    'product-search': (n) => productSearch[n % productSearch.length]!(n),
    'stock-view': (n) => stockView[n % stockView.length]!(n),
  };
}

/** Signs in once and returns the `Cookie` header every later request carries. */
export async function signIn(email: string): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Sign-in as ${email} failed with ${response.status}.`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Sign-in did not set a session cookie.');
  return cookie;
}

/** One timed request. Returns the elapsed milliseconds, or null when the answer was not a valid page. */
async function timedRequest(path: string, cookie: string): Promise<number | null> {
  const started = performance.now();
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { cookie },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body: unknown = await response.json();
    const elapsed = performance.now() - started;
    const items = (body as { items?: unknown }).items;
    return response.ok && Array.isArray(items) ? elapsed : null;
  } catch {
    return null;
  }
}

export async function runLoad(options: {
  dataset: DatasetSummary;
  cookie: string;
  virtualUsers: number;
  durationMs: number;
  onProgress?: (line: string) => void;
}): Promise<LoadOutcome> {
  const { dataset, cookie, virtualUsers, durationMs } = options;
  const scenarios = scenariosFor(dataset);
  const names: EndpointName[] = [...NFR05.endpoints];
  const endpoints: Record<EndpointName, EndpointResult> = {
    'product-search': { latenciesMs: [], failedRequests: 0 },
    'stock-view': { latenciesMs: [], failedRequests: 0 },
  };

  // Warm up the connection pool and the API's prepared statements. Not measured.
  for (const name of names) await timedRequest(scenarios[name](0), cookie);

  const started = performance.now();
  const deadline = started + durationMs;

  const progress = options.onProgress
    ? setInterval(() => {
        const seconds = Math.round((performance.now() - started) / 1000);
        const requests = names.reduce(
          (total, name) => total + endpoints[name].latenciesMs.length,
          0,
        );
        options.onProgress?.(`${seconds}s elapsed, ${requests} requests answered`);
      }, 30_000)
    : undefined;

  const user = async (index: number) => {
    // Users start at different points of the request mix so they do not move in step.
    for (let step = index; performance.now() < deadline; step++) {
      const name = names[step % names.length]!;
      // `n` advances once per visit to the same API, so it walks through every request shape and term.
      const n = Math.floor(step / names.length) + index;
      const elapsed = await timedRequest(scenarios[name](n), cookie);
      if (elapsed === null) endpoints[name].failedRequests++;
      else endpoints[name].latenciesMs.push(elapsed);
    }
  };
  await Promise.all(Array.from({ length: virtualUsers }, (_, index) => user(index)));
  clearInterval(progress);

  return { endpoints, durationMs: performance.now() - started, virtualUsers };
}
