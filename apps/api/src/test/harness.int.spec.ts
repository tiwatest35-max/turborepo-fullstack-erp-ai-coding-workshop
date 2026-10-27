import { describe, expect, it } from 'vitest';
import { workerDatabaseName } from './database.js';
import { resetDatabase, useIntegrationDatabase } from './integration.js';

describe('integration harness', () => {
  const db = useIntegrationDatabase();

  it('gives this worker its own migrated database', async () => {
    const [{ current_database }] = await db.prisma.$queryRaw<{ current_database: string }[]>`
      SELECT current_database()`;

    expect(current_database).toBe(workerDatabaseName());
    expect(current_database).not.toBe('erp');
  });

  it('loads the TOR 8.1 starting data: stores, supplier, products, users and thresholds', async () => {
    const stores = await db.prisma.store.findMany({ orderBy: { code: 'asc' } });
    const products = await db.prisma.product.findMany({
      orderBy: { sku: 'asc' },
      include: { reorderThresholds: true },
    });
    const users = await db.prisma.user.findMany({ orderBy: { email: 'asc' } });

    expect(stores.map((s) => [s.code, s.name])).toEqual([
      ['B01', 'Central Store'],
      ['B02', 'Riverside Store'],
    ]);
    expect((await db.prisma.supplier.findMany()).map((s) => [s.code, s.name])).toEqual([
      ['SUP01', 'SupplyOne Co Ltd'],
    ]);
    expect(products.map((p) => [p.sku, p.name, Number(p.sellingPrice)])).toEqual([
      ['SKU001', 'Drinking water pack of 6', 60],
      ['SKU002', 'Tissue paper', 35],
      ['SKU003', 'Laundry detergent', 120],
    ]);
    // Every product has a reorder threshold of 3 in both stores.
    for (const product of products) {
      expect(product.reorderThresholds.map((t) => t.threshold)).toEqual([3, 3]);
    }
    expect(users.map((u) => u.email)).toEqual([
      'admin@erp.local',
      'buyer01@erp.local',
      'manager01@erp.local',
      'staff_b01@erp.local',
      'staff_b02@erp.local',
    ]);
  });

  it('loads the starting stock: B01 holds 10, 5 and 0, and every B02 balance is zero', async () => {
    const balances = await db.prisma.stockBalance.findMany({
      include: { product: true, store: true },
      orderBy: [{ store: { code: 'asc' } }, { product: { sku: 'asc' } }],
    });

    expect(balances.map((b) => [b.store.code, b.product.sku, b.quantity])).toEqual([
      ['B01', 'SKU001', 10],
      ['B01', 'SKU002', 5],
      ['B01', 'SKU003', 0],
      ['B02', 'SKU001', 0],
      ['B02', 'SKU002', 0],
      ['B02', 'SKU003', 0],
    ]);
  });

  it('resets between scenarios: rows one scenario adds are gone in the next', async () => {
    const stores = await db.prisma.store.count();
    await db.prisma.store.create({ data: { code: 'B99', name: 'Scratch store' } });
    expect(await db.prisma.store.count()).toBe(stores + 1);

    await resetDatabase(db.prisma);

    expect(await db.prisma.store.count()).toBe(stores);
    expect(await db.prisma.store.findUnique({ where: { code: 'B99' } })).toBeNull();
  });
});
