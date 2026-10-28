import { expect, test, type Browser } from '@playwright/test';
import { storageState, type AccountName } from './accounts.js';

type Page<T> = { items: T[] };

/**
 * Demo: staff_b01 sees only B01 movements and can open the source document; manager01 sees
 * movements across all stores (RPT-03).
 *
 * The test stocks its own product into B01 through a purchase order and a goods receipt, so the
 * ledger gets a RECEIPT movement that carries a real source-document number. It then reads the
 * movement-history report as the store employee (scoped to B01) and as the manager (all stores).
 */
test.describe('movement reports', () => {
  test('staff_b01 sees the B01 movement with its source document and cannot pick another store; manager01 sees the same movement with the store filter open', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const sku = `E2E-MOVE-${Date.now()}`;
    const as = (name: AccountName) =>
      playwright.request.newContext({ baseURL, storageState: storageState(name) });

    // A product nobody else touches, stocked only in B01.
    const admin = await as('admin');
    const product = await admin.post('/api/products', {
      data: {
        sku,
        name: `Movement item ${sku}`,
        category: 'Furniture',
        unit: 'piece',
        sellingPrice: 100,
      },
    });
    expect(product.ok()).toBe(true);
    const productId = ((await product.json()) as { id: string }).id;
    await admin.dispose();

    // buyer01 orders 4 for B01, manager01 approves.
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
        lines: [{ productId, quantity: 4, unitPrice: 45 }],
      },
    });
    expect(created.ok()).toBe(true);
    const order = (await created.json()) as { id: string; lines: { id: string }[] };
    expect((await buyer.post(`/api/purchase-orders/${order.id}/submit`)).ok()).toBe(true);
    await buyer.dispose();

    const managerApi = await as('manager');
    expect((await managerApi.post(`/api/purchase-orders/${order.id}/approve`)).ok()).toBe(true);
    await managerApi.dispose();

    // staff_b01 receives all 4 at B01: this writes a RECEIPT movement carrying the GR number.
    const staffApi = await as('staff');
    const received = await staffApi.post('/api/goods-receipts', {
      data: {
        purchaseOrderId: order.id,
        idempotencyKey: `e2e-move-receipt-${sku}`,
        lines: [{ purchaseOrderLineId: order.lines[0]!.id, quantity: 4 }],
      },
    });
    expect(received.ok()).toBe(true);
    const receiptNumber = ((await received.json()) as { number: string }).number;
    expect(receiptNumber, 'the receipt carries a document number').toBeTruthy();
    await staffApi.dispose();

    // The store employee sees the B01 movement with its source document, and the store filter is
    // locked to their own store.
    await onReportPage(browser, baseURL, 'staff', { productId, sku }, async (page, row) => {
      await expect(row).toContainText('B01');
      await expect(row).toContainText(receiptNumber);
      await expect(page.getByLabel('สาขา')).toBeDisabled();
    });

    // The manager sees the same movement with the store filter open to all stores.
    await onReportPage(browser, baseURL, 'manager', { productId, sku }, async (page, row) => {
      await expect(row).toContainText('B01');
      await expect(row).toContainText(receiptNumber);
      await expect(page.getByLabel('สาขา')).toBeEnabled();
    });
  });
});

/** Open the movement report as one account, filter to the product, and run assertions on its row. */
async function onReportPage(
  browser: Browser,
  baseURL: string | undefined,
  account: AccountName,
  product: { productId: string; sku: string },
  run: (
    page: import('@playwright/test').Page,
    row: import('@playwright/test').Locator,
  ) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ baseURL, storageState: storageState(account) });
  const page = await context.newPage();
  try {
    await page.goto('/reports/movements');
    await expect(
      page.getByRole('heading', { name: 'รายงานประวัติการเคลื่อนไหวสต็อก', level: 1 }),
    ).toBeVisible();
    // The filter takes the product id; the row shows the SKU.
    await page.getByLabel('สินค้า').fill(product.productId);
    const row = page.getByRole('row').filter({ hasText: product.sku });
    await run(page, row);
  } finally {
    await context.close();
  }
}
