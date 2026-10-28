import { expect, test, type APIRequestContext } from '@playwright/test';
import { storageState } from './accounts.js';

type Page<T> = { items: T[] };

test.describe('sales concurrency', () => {
  test('with a product at 10 in B01, two concurrent sales of 7 each resolve to exactly one success and one rejection, with final stock 3', async ({
    playwright,
    baseURL,
  }) => {
    // The seeded SKU001 is read by other tests, so this test stocks its own product with 10.
    const sku = `E2E-CONCURRENT-${Date.now()}`;
    const as = (name: 'admin' | 'buyer' | 'manager' | 'staff') =>
      playwright.request.newContext({ baseURL, storageState: storageState(name) });

    const admin = await as('admin');
    const product = await admin.post('/api/products', {
      data: {
        sku,
        name: `Concurrency item ${sku}`,
        category: 'Furniture',
        unit: 'piece',
        sellingPrice: 100,
      },
    });
    expect(product.ok()).toBe(true);
    const productId = ((await product.json()) as { id: string }).id;
    await admin.dispose();

    // Buy 10 for B01: buyer01 orders, manager01 approves.
    const buyer = await as('buyer');
    const idOf = async (path: string, code: string) => {
      const response = await buyer.get(`/api/${path}?page=1&pageSize=100`);
      expect(response.ok()).toBe(true);
      const found = ((await response.json()) as Page<{ id: string; code: string }>).items.find(
        (item) => item.code === code,
      );
      expect(found, `${code} exists in the seed`).toBeDefined();
      return found!.id;
    };
    const created = await buyer.post('/api/purchase-orders', {
      data: {
        supplierId: await idOf('suppliers', 'SUP01'),
        storeId: await idOf('stores', 'B01'),
        expectedReceiptDate: '2026-12-01',
        lines: [{ productId, quantity: 10, unitPrice: 45 }],
      },
    });
    expect(created.ok()).toBe(true);
    const order = (await created.json()) as { id: string; lines: { id: string }[] };
    expect((await buyer.post(`/api/purchase-orders/${order.id}/submit`)).ok()).toBe(true);
    await buyer.dispose();

    const manager = await as('manager');
    expect((await manager.post(`/api/purchase-orders/${order.id}/approve`)).ok()).toBe(true);
    await manager.dispose();

    // Receive all 10 at B01, so the balance is exactly 10.
    const staff = await as('staff');
    const received = await staff.post('/api/goods-receipts', {
      data: {
        purchaseOrderId: order.id,
        idempotencyKey: `e2e-receipt-${sku}`,
        lines: [{ purchaseOrderLineId: order.lines[0]!.id, quantity: 10 }],
      },
    });
    expect(received.ok()).toBe(true);
    expect(await onHand(staff, sku)).toBe(10);

    // Two sales of 7 at the same moment, each with its own idempotency key.
    const sell = (key: string) =>
      staff.post('/api/sales', {
        data: { idempotencyKey: `e2e-sale-${sku}-${key}`, lines: [{ productId, quantity: 7 }] },
      });
    const [first, second] = await Promise.all([sell('a'), sell('b')]);

    const statuses = [first.status(), second.status()].sort();
    expect(statuses).toEqual([200, 409]);
    const rejection = first.ok() ? second : first;
    expect(((await rejection.json()) as { data: { code: string } }).data.code).toBe(
      'SALE_INSUFFICIENT_STOCK',
    );
    expect(await onHand(staff, sku)).toBe(3);
    await staff.dispose();
  });
});

/** The quantity of this SKU in the signed-in employee's store. */
async function onHand(request: APIRequestContext, sku: string): Promise<number> {
  const response = await request.get(`/api/stock?search=${encodeURIComponent(sku)}`);
  expect(response.ok()).toBe(true);
  const rows = ((await response.json()) as Page<{ sku: string; quantity: number }>).items.filter(
    (row) => row.sku === sku,
  );
  expect(rows).toHaveLength(1);
  return rows[0]!.quantity;
}
