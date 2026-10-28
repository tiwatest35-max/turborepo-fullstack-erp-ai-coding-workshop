/**
 * The NFR-05 acceptance rule, kept apart from the code that generates load so the rule itself
 * can be checked: p95 at or below 2 seconds on the search and stock-view APIs, for 10 concurrent
 * users over a continuous 5 minutes, on a dataset of 1,000 products and 10,000 movements.
 */

export const NFR05 = {
  p95LimitMs: 2_000,
  virtualUsers: 10,
  durationMs: 5 * 60 * 1000,
  products: 1_000,
  movements: 10_000,
  /** The APIs the requirement covers. CSV exports are excluded. */
  endpoints: ['product-search', 'stock-view'],
} as const;

export type EndpointName = (typeof NFR05.endpoints)[number];

export type EndpointResult = {
  /** Response time of every completed request, in milliseconds. */
  latenciesMs: number[];
  /** Requests that errored or answered with something other than a valid 200. */
  failedRequests: number;
};

export type LoadRun = {
  dataset: { products: number; movements: number };
  virtualUsers: number;
  /** How long the load actually ran. */
  durationMs: number;
  endpoints: Partial<Record<EndpointName, EndpointResult>>;
};

export type EndpointSummary = {
  requests: number;
  failedRequests: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
};

export type Verdict = {
  passed: boolean;
  /** One sentence per way the run missed the requirement. Empty when it passed. */
  problems: string[];
  endpoints: Partial<Record<EndpointName, EndpointSummary>>;
};

function summarize({ latenciesMs, failedRequests }: EndpointResult): EndpointSummary {
  const sorted = Float64Array.from(latenciesMs).sort();
  // Nearest rank: the smallest sample that at least p percent of the samples do not exceed.
  const at = (p: number) => sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1]!;
  return {
    requests: latenciesMs.length + failedRequests,
    failedRequests,
    minMs: sorted[0]!,
    p50Ms: at(50),
    p95Ms: at(95),
    p99Ms: at(99),
    maxMs: sorted[sorted.length - 1]!,
  };
}

export function evaluate(run: LoadRun): Verdict {
  const problems: string[] = [];

  if (run.dataset.products !== NFR05.products || run.dataset.movements !== NFR05.movements) {
    problems.push(
      `Dataset is ${run.dataset.products} products and ${run.dataset.movements} movements; ` +
        `NFR-05 needs ${NFR05.products} and ${NFR05.movements}.`,
    );
  }
  if (run.virtualUsers < NFR05.virtualUsers) {
    problems.push(`Only ${run.virtualUsers} virtual users; NFR-05 needs ${NFR05.virtualUsers}.`);
  }
  if (run.durationMs < NFR05.durationMs) {
    problems.push(
      `The load ran ${Math.round(run.durationMs / 1000)} s; NFR-05 needs ${NFR05.durationMs / 1000} s.`,
    );
  }

  const endpoints: Verdict['endpoints'] = {};
  for (const name of NFR05.endpoints) {
    const result = run.endpoints[name];
    if (!result || result.latenciesMs.length === 0) {
      problems.push(`${name} was never measured.`);
      continue;
    }
    const summary = summarize(result);
    endpoints[name] = summary;
    if (result.failedRequests > 0) {
      problems.push(`${name} had ${result.failedRequests} failed requests.`);
    }
    if (summary.p95Ms > NFR05.p95LimitMs) {
      problems.push(`${name} p95 is ${summary.p95Ms} ms; the limit is ${NFR05.p95LimitMs} ms.`);
    }
  }

  return { passed: problems.length === 0, problems, endpoints };
}
