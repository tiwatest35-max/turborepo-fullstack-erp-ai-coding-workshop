import { describe, expect, it } from 'vitest';
import {
  AdjustStockInputSchema,
  ListStockMovementsInputSchema,
  SearchStockInputSchema,
  StockLevelSchema,
  StockMovementSchema,
  stockContract,
} from './stock.js';

const level = {
  productId: 'p1',
  sku: 'SKU001',
  productName: 'Drinking water pack of 6',
  unit: 'pack',
  storeId: 's1',
  storeCode: 'B01',
  storeName: 'Central Store',
  quantity: 10,
  reorderThreshold: 3,
  lowStock: false,
};

const movement = {
  id: 'm1',
  productId: 'p1',
  productSku: 'SKU001',
  productName: 'Drinking water pack of 6',
  storeId: 's1',
  storeCode: 'B01',
  quantityChange: 10,
  balanceBefore: 0,
  balanceAfter: 10,
  movementType: 'OPENING',
  sourceDocumentType: 'OPENING_BALANCE',
  sourceDocumentNumber: null,
  actorId: 'u1',
  actorName: 'Manager 01',
  createdAt: '2026-10-27T07:00:00.000Z',
};

describe('stock schemas', () => {
  it('accepts a stock level with or without a reorder threshold', () => {
    expect(StockLevelSchema.safeParse(level).success).toBe(true);
    expect(
      StockLevelSchema.safeParse({ ...level, reorderThreshold: null, lowStock: false }).success,
    ).toBe(true);
  });

  it('rejects a negative or fractional quantity', () => {
    expect(StockLevelSchema.safeParse({ ...level, quantity: -1 }).success).toBe(false);
    expect(StockLevelSchema.safeParse({ ...level, quantity: 1.5 }).success).toBe(false);
  });

  it('defaults the page, trims the search and drops an empty one', () => {
    expect(SearchStockInputSchema.parse({ search: '  SKU001 ' })).toEqual({
      page: 1,
      pageSize: 20,
      search: 'SKU001',
    });
    expect(SearchStockInputSchema.safeParse({ search: '   ' }).success).toBe(false);
  });

  it('reads the low-stock filter from a query string or a boolean', () => {
    expect(SearchStockInputSchema.parse({ lowStockOnly: 'true' }).lowStockOnly).toBe(true);
    expect(SearchStockInputSchema.parse({ lowStockOnly: 'false' }).lowStockOnly).toBe(false);
    expect(SearchStockInputSchema.parse({ lowStockOnly: true }).lowStockOnly).toBe(true);
    expect(SearchStockInputSchema.parse({}).lowStockOnly).toBeUndefined();
    expect(SearchStockInputSchema.safeParse({ lowStockOnly: 'maybe' }).success).toBe(false);
  });

  it('accepts a movement with balances that cannot be negative', () => {
    expect(StockMovementSchema.safeParse(movement).success).toBe(true);
    expect(StockMovementSchema.safeParse({ ...movement, balanceAfter: -1 }).success).toBe(false);
    expect(StockMovementSchema.safeParse({ ...movement, quantityChange: 0 }).success).toBe(false);
    expect(StockMovementSchema.safeParse({ ...movement, movementType: 'GIFT' }).success).toBe(
      false,
    );
  });

  it('filters movements by product and store', () => {
    expect(ListStockMovementsInputSchema.parse({ productId: 'p1', storeId: 's1' })).toMatchObject({
      productId: 'p1',
      storeId: 's1',
    });
  });

  it('exposes search, the CSV export, movements and the manager adjustment (INV-02, INV-05, RPT-04)', () => {
    expect(Object.keys(stockContract).sort()).toEqual([
      'adjust',
      'exportCsv',
      'movements',
      'search',
    ]);
  });
});

describe('AdjustStockInputSchema (INV-05)', () => {
  const valid = {
    productId: 'p1',
    storeId: 's1',
    quantityChange: 5,
    reason: 'พบของเพิ่มจากการนับสต็อก',
  };

  it('accepts an increase and a decrease with a reason', () => {
    expect(AdjustStockInputSchema.safeParse(valid).success).toBe(true);
    expect(AdjustStockInputSchema.safeParse({ ...valid, quantityChange: -3 }).success).toBe(true);
  });

  it('rejects a zero change', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, quantityChange: 0 }).success).toBe(false);
  });

  it('rejects a fractional change', () => {
    expect(AdjustStockInputSchema.safeParse({ ...valid, quantityChange: 1.5 }).success).toBe(false);
  });

  it('rejects a missing or empty reason (mandatory, INV-05)', () => {
    const { reason: _reason, ...noReason } = valid;
    expect(AdjustStockInputSchema.safeParse(noReason).success).toBe(false);
    expect(AdjustStockInputSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
    expect(AdjustStockInputSchema.safeParse({ ...valid, reason: '   ' }).success).toBe(false);
  });
});
