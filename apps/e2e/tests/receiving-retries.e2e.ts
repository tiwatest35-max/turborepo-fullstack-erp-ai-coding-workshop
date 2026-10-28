import { expect, test, type APIRequestContext } from '@playwright/test';
import { storageState } from './accounts.js';

type Page<T> = { items: T[] };

test.describe('goods receipt retries and concurrency', () => {
  test.use({ storageState: storageState('staff') });

  test('after receiving 8 successfully, resending the identical request returns the original receipt with stock unchanged; two concurrent receipts cannot push cumulative received past the ordered quantity', async ({
    page,
    playwright,
    baseURL,
    request,
  }) => {
    const sku = `E2E-GR-${Date.now()}`;
    const as = (name: 'admin' | 'buyer' | 'manager') =>
      playwright.request.newContext({ baseURL, storageState: storageState(name) });

    // Data: a new product, and a PO for 20 of it for B01, approved.
    const admin = await as('admin');
    const created = await admin.post('/api/products', {
      data: {
        sku,
        name: `Receiving item ${sku}`,
        category: 'Furniture',
        unit: 'box',
        sellingPrice: 100,
      },
    });
    expect(created.ok()).toBe(true);
    const productId = ((await created.json()) as { id: string }).id;
    await admin.dispose();

    const buyer = await as('buyer');
    const idOf = async (path: string, code: string) => {
      const response = await buyer.get(`/api/${path}?page=1&pageSize=100`);
      const found = ((await response.json()) as Page<{ id: string; code: string }>).items.find(
        (item) => item.code === code,
      );
      expect(found, `${code} exists in the seed`).toBeDefined();
      return found!.id;
    };
    const order = await buyer.post('/api/purchase-orders', {
      data: {
        supplierId: await idOf('suppliers', 'SUP01'),
        storeId: await idOf('stores', 'B01'),
        expectedReceiptDate: '2026-12-01',
        lines: [{ productId, quantity: 20, unitPrice: 45 }],
      },
    });
    expect(order.ok()).toBe(true);
    const { id: orderId, number } = (await order.json()) as { id: string; number: string };
    expect((await buyer.post(`/api/purchase-orders/${orderId}/submit`)).ok()).toBe(true);
    await buyer.dispose();
    const manager = await as('manager');
    expect((await manager.post(`/api/purchase-orders/${orderId}/approve`)).ok()).toBe(true);
    await manager.dispose();

    // Receive 8 on the receiving page.
    await page.goto('/receiving');
    await expect(page.getByRole('heading', { name: 'รับสินค้า', level: 1 })).toBeVisible();
    const line = page.getByRole('listitem').filter({ hasText: sku });
    await page.getByLabel(`รับ ${sku}`).fill('8');
    await page.getByRole('button', { name: `ยืนยันการรับสินค้า ${number}` }).click();
    await expect(line.getByText(/รับแล้ว 8 · คงเหลือ 12/)).toBeVisible();

    const lineId = await receivableLineId(request, orderId);
    const stockOf = async () => {
      const response = await request.get(`/api/stock?search=${sku}&page=1&pageSize=10`);
      const items = ((await response.json()) as Page<{ sku: string; quantity: number }>).items;
      return items.find((item) => item.sku === sku)?.quantity;
    };
    expect(await stockOf()).toBe(8);

    // The identical request, sent again, returns the receipt the first one made.
    const key = `e2e-${sku}`;
    const body = {
      purchaseOrderId: orderId,
      idempotencyKey: key,
      lines: [{ purchaseOrderLineId: lineId, quantity: 5 }],
    };
    const first = await request.post('/api/goods-receipts', { data: body });
    expect(first.ok()).toBe(true);
    const firstReceipt = (await first.json()) as { id: string; number: string };
    const resent = await request.post('/api/goods-receipts', { data: body });
    expect(resent.ok()).toBe(true);
    expect(await resent.json()).toMatchObject({ id: firstReceipt.id, number: firstReceipt.number });
    expect(await stockOf()).toBe(13);

    // Two concurrent receipts of 5 against 7 still outstanding: exactly one is accepted.
    const attempt = (suffix: string) =>
      request.post('/api/goods-receipts', {
        data: {
          purchaseOrderId: orderId,
          idempotencyKey: `${key}-${suffix}`,
          lines: [{ purchaseOrderLineId: lineId, quantity: 5 }],
        },
      });
    const statuses = (await Promise.all([attempt('a'), attempt('b')])).map((r) => r.status());
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 400)).toHaveLength(1);
    expect(await stockOf()).toBe(18);

    await page.reload();
    await expect(line.getByText(/รับแล้ว 18 · คงเหลือ 2/)).toBeVisible();
  });
});

/** The id of the order's only line, read from the receiving screen's own endpoint. */
async function receivableLineId(request: APIRequestContext, orderId: string) {
  const response = await request.get('/api/receiving/orders?page=1&pageSize=100');
  const orders = ((await response.json()) as Page<{ id: string; lines: { id: string }[] }>).items;
  return orders.find((order) => order.id === orderId)!.lines[0]!.id;
}
