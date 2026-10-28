import { describe, expect, it } from 'vitest';
import { evaluate, type LoadRun } from './verdict.js';

/** A run that satisfies NFR-05 in every respect. Each test breaks exactly one thing. */
function passingRun(): LoadRun {
  return {
    dataset: { products: 1_000, movements: 10_000 },
    virtualUsers: 10,
    durationMs: 300_000,
    endpoints: {
      'product-search': { latenciesMs: [40, 55, 60, 80, 120], failedRequests: 0 },
      'stock-view': { latenciesMs: [90, 110, 130, 150, 400], failedRequests: 0 },
    },
  };
}

/** `fast` samples of 100 ms followed by `slow` samples of `slowMs`. */
const latencies = (fast: number, slow: number, slowMs: number) => [
  ...Array<number>(fast).fill(100),
  ...Array<number>(slow).fill(slowMs),
];

describe('NFR-05 verdict', () => {
  it('passes when every API is under 2 s at p95 for 10 users over 5 minutes on the full dataset', () => {
    const verdict = evaluate(passingRun());

    expect(verdict.passed).toBe(true);
    expect(verdict.problems).toEqual([]);
    expect(verdict.endpoints['product-search']?.p95Ms).toBe(120);
    expect(verdict.endpoints['stock-view']?.p95Ms).toBe(400);
  });

  it('fails when the p95 of one API is above 2 seconds', () => {
    const run = passingRun();
    // 100 samples sorted: the 95th is the first of the five slow ones.
    run.endpoints['stock-view'] = { latenciesMs: latencies(94, 6, 2_001), failedRequests: 0 };

    const verdict = evaluate(run);

    expect(verdict.passed).toBe(false);
    expect(verdict.endpoints['stock-view']?.p95Ms).toBe(2_001);
    expect(verdict.problems).toEqual([expect.stringContaining('stock-view')]);
  });

  it('passes when the p95 is exactly 2 seconds', () => {
    const run = passingRun();
    run.endpoints['product-search'] = { latenciesMs: latencies(94, 6, 2_000), failedRequests: 0 };

    expect(evaluate(run).passed).toBe(true);
  });

  it('ignores a slow tail beyond the 95th percentile', () => {
    const run = passingRun();
    run.endpoints['product-search'] = { latenciesMs: latencies(95, 5, 9_000), failedRequests: 0 };

    const verdict = evaluate(run);

    expect(verdict.endpoints['product-search']?.p95Ms).toBe(100);
    expect(verdict.passed).toBe(true);
  });

  it('fails when any request failed, however fast the rest were', () => {
    const run = passingRun();
    run.endpoints['product-search'] = { latenciesMs: [50, 60], failedRequests: 1 };

    const verdict = evaluate(run);

    expect(verdict.passed).toBe(false);
    expect(verdict.problems).toEqual([expect.stringContaining('product-search')]);
  });

  it('fails when the run was shorter than 5 minutes', () => {
    const run = passingRun();
    run.durationMs = 299_000;

    expect(evaluate(run).passed).toBe(false);
  });

  it('fails when fewer than 10 users drove the load', () => {
    const run = passingRun();
    run.virtualUsers = 9;

    expect(evaluate(run).passed).toBe(false);
  });

  it('fails when the dataset is not 1,000 products and 10,000 movements', () => {
    const fewProducts = passingRun();
    fewProducts.dataset = { products: 999, movements: 10_000 };
    const fewMovements = passingRun();
    fewMovements.dataset = { products: 1_000, movements: 9_999 };

    expect(evaluate(fewProducts).passed).toBe(false);
    expect(evaluate(fewMovements).passed).toBe(false);
  });

  it('fails when an API was never measured, so an empty run cannot pass', () => {
    const run = passingRun();
    run.endpoints['stock-view'] = { latenciesMs: [], failedRequests: 0 };

    const verdict = evaluate(run);

    expect(verdict.passed).toBe(false);
    expect(verdict.problems).toEqual([expect.stringContaining('stock-view')]);
  });

  it('fails when one of the two required APIs is missing from the run', () => {
    const run = passingRun();
    delete run.endpoints['stock-view'];

    expect(evaluate(run).passed).toBe(false);
  });
});
