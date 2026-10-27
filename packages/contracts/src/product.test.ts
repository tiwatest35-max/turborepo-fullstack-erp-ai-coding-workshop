import { describe, expect, it } from 'vitest';
import { contract } from './index.js';
import {
  CreateProductInputSchema,
  ListProductsInputSchema,
  ProductSchema,
  UpdateProductInputSchema,
} from './product.js';

const valid = {
  sku: 'SKU001',
  name: 'Notebook A5',
  category: 'Stationery',
  unit: 'pack',
  sellingPrice: 60,
  active: true,
  reorderThresholds: [{ storeId: 'st1', threshold: 3 }],
};

describe('ProductSchema', () => {
  it('accepts a product with every MD-01 field', () => {
    expect(ProductSchema.safeParse({ id: 'p1', ...valid }).success).toBe(true);
  });

  it('rejects a product missing its SKU', () => {
    const { sku: _sku, ...withoutSku } = valid;
    expect(ProductSchema.safeParse({ id: 'p1', ...withoutSku }).success).toBe(false);
  });
});

describe('CreateProductInputSchema', () => {
  it('accepts a create payload without an id', () => {
    expect(CreateProductInputSchema.safeParse(valid).success).toBe(true);
  });

  it('defaults a new product to active with no reorder thresholds', () => {
    const { active: _active, reorderThresholds: _thresholds, ...minimal } = valid;

    const result = CreateProductInputSchema.safeParse(minimal);

    expect(result.success && result.data.active).toBe(true);
    expect(result.success && result.data.reorderThresholds).toEqual([]);
  });

  it('rejects an id (id is server-assigned)', () => {
    expect(CreateProductInputSchema.safeParse({ id: 'p1', ...valid }).success).toBe(false);
  });

  it('rejects an empty SKU', () => {
    expect(CreateProductInputSchema.safeParse({ ...valid, sku: '' }).success).toBe(false);
  });

  it('rejects a negative selling price (MD-02)', () => {
    expect(CreateProductInputSchema.safeParse({ ...valid, sellingPrice: -0.01 }).success).toBe(
      false,
    );
  });

  it('accepts a selling price of zero', () => {
    expect(CreateProductInputSchema.safeParse({ ...valid, sellingPrice: 0 }).success).toBe(true);
  });

  it('rejects a selling price with more than two decimal places', () => {
    expect(CreateProductInputSchema.safeParse({ ...valid, sellingPrice: 10.005 }).success).toBe(
      false,
    );
  });

  it('rejects a negative reorder threshold (MD-02)', () => {
    const reorderThresholds = [{ storeId: 'st1', threshold: -1 }];
    expect(CreateProductInputSchema.safeParse({ ...valid, reorderThresholds }).success).toBe(false);
  });

  it('rejects a fractional reorder threshold (whole numbers only, MD-02)', () => {
    const reorderThresholds = [{ storeId: 'st1', threshold: 2.5 }];
    expect(CreateProductInputSchema.safeParse({ ...valid, reorderThresholds }).success).toBe(false);
  });

  it('rejects two thresholds for the same store', () => {
    const reorderThresholds = [
      { storeId: 'st1', threshold: 3 },
      { storeId: 'st1', threshold: 5 },
    ];
    expect(CreateProductInputSchema.safeParse({ ...valid, reorderThresholds }).success).toBe(false);
  });
});

describe('UpdateProductInputSchema', () => {
  it('accepts an id with any editable field, such as deactivating', () => {
    expect(UpdateProductInputSchema.safeParse({ id: 'p1', active: false }).success).toBe(true);
  });

  it('rejects an update without an id', () => {
    expect(UpdateProductInputSchema.safeParse({ name: 'No id' }).success).toBe(false);
  });

  it('rejects a negative selling price on update', () => {
    expect(UpdateProductInputSchema.safeParse({ id: 'p1', sellingPrice: -5 }).success).toBe(false);
  });

  it('rejects a fractional reorder threshold on update', () => {
    const reorderThresholds = [{ storeId: 'st1', threshold: 0.5 }];
    expect(UpdateProductInputSchema.safeParse({ id: 'p1', reorderThresholds }).success).toBe(false);
  });
});

describe('ListProductsInputSchema', () => {
  it('defaults to every product, active or not, so deactivated ones stay searchable', () => {
    const result = ListProductsInputSchema.parse({});

    expect(result.status).toBe('all');
    expect(result.search).toBeUndefined();
  });

  it('accepts an active-status filter and a search term', () => {
    expect(ListProductsInputSchema.safeParse({ status: 'active', search: 'note' }).success).toBe(
      true,
    );
  });

  it('rejects an unknown status', () => {
    expect(ListProductsInputSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});

describe('contract.products', () => {
  it('exposes list, get, create and update routes', () => {
    expect(Object.keys(contract.products).sort()).toEqual(['create', 'get', 'list', 'update']);
  });
});
