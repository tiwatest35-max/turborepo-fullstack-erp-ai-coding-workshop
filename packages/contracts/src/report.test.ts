import { describe, expect, it } from 'vitest';
import { MovementReportInputSchema, reportContract } from './report.js';

describe('MovementReportInputSchema (RPT-03)', () => {
  it('defaults pagination and accepts all optional filters', () => {
    const parsed = MovementReportInputSchema.parse({
      productId: 'p1',
      storeId: 's1',
      movementType: 'SALE',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(parsed).toMatchObject({
      page: 1,
      pageSize: 20,
      productId: 'p1',
      storeId: 's1',
      movementType: 'SALE',
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });

  it('accepts an empty filter (all movements)', () => {
    expect(MovementReportInputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects an unknown movement type', () => {
    expect(MovementReportInputSchema.safeParse({ movementType: 'GIFT' }).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(MovementReportInputSchema.safeParse({ from: '01/10/2026' }).success).toBe(false);
  });

  it('rejects a range whose start is after its end', () => {
    expect(
      MovementReportInputSchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success,
    ).toBe(false);
  });
});

describe('reportContract', () => {
  it('exposes the daily sales and movement-history reports', () => {
    expect(Object.keys(reportContract).sort()).toEqual([
      'dailySales',
      'dailySalesCsv',
      'movements',
    ]);
  });
});
