import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import { storageState, type AccountName } from './accounts.js';

type Page<T> = { items: T[] };

/**
 * Demo: staff_b01 sees only B01 movements and can open the source document; manager01 sees
 * movements across all stores (RPT-03).
 *
 * The test stocks the same product into B01 and B02 through purchase orders and goods receipts,
 * so the ledger gets a RECEIPT movement in each store, each carrying a real source-document
 * number. It then reads the movement-history report as the store employee (who sees only the B01
 * receipt, with the store filter locked) and as the manager (who sees both stores' receipts).
 */
test.describe('movement reports', () => {
  test('staff_b01 sees only the B01 receipt with its source document and cannot pick another store; manager01 sees both stores', async ({
    browser,
    playwright,
    baseURL,
  }) => {
    const sku = `E2E-MOVE-${Date.now()}`;
    const productName = `Movement item ${sku}`;
    const productLabel = `${sku} ${productName}`;
    const as = (name: AccountName) =>
      playwright.request.newContext({ baseURL, storageState: storageState(name) });

    // One product, stocked into both stores.
    const admin = await as('admin');
    const product = await admin.post('/api/products', {
      data: { sku, name: productName, category: 'Furniture', unit: 'piece', sellingPrice: 100 },
    });
    expect(product.ok()).toBe(true);
    const productId = ((await product.json()) as { id: string }).id;
    await admin.dispose();

    // A RECEIPT movement in each store: buyer orders, manager approves, the store's staff receives.
    const b01Receipt = await stockStore(as, { productId, sku, storeCode: 'B01', staff: 'staff' });
    const b02Receipt = await stockStore(as, {
      productId,
      sku,
      storeCode: 'B02',
      staff: 'staffB02',
    });

    // The store employee sees their own store's receipt with its source document, not the other
    // store's, and the store filter is locked to B01.
    await onReportPage(browser, baseURL, 'staff', productLabel, async (page) => {
      await expect(page.getByRole('row').filter({ hasText: b01Receipt })).toContainText('B01');
      await expect(page.getByRole('row').filter({ hasText: b02Receipt })).toHaveCount(0);
      await expect(page.getByLabel('สาขา')).toBeDisabled();
    });

    // The manager sees both stores' receipts with the store filter open to all stores.
    await onReportPage(browser, baseURL, 'manager', productLabel, async (page) => {
      await expect(page.getByRole('row').filter({ hasText: b01Receipt })).toContainText('B01');
      await expect(page.getByRole('row').filter({ hasText: b02Receipt })).toContainText('B02');
      await expect(page.getByLabel('สาขา')).toBeEnabled();
    });
  });
});

/**
 * Orders `quantity` of the product for one store (buyer01), approves it (manager01), and receives
 * it as that store's employee, which writes a RECEIPT stock movement. Returns the receipt's
 * document number so a test can find its movement row.
 */
async function stockStore(
  as: (name: AccountName) => Promise<APIRequestContext>,
  opts: {
    productId: string;
    sku: string;
    storeCode: string;
    staff: AccountName;
    quantity?: number;
  },
): Promise<string> {
  const quantity = opts.quantity ?? 4;

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
      storeId: await idOf('stores', opts.storeCode),
      expectedReceiptDate: '2026-12-01',
      lines: [{ productId: opts.productId, quantity, unitPrice: 45 }],
    },
  });
  expect(created.ok()).toBe(true);
  const order = (await created.json()) as { id: string; lines: { id: string }[] };
  expect((await buyer.post(`/api/purchase-orders/${order.id}/submit`)).ok()).toBe(true);
  await buyer.dispose();

  const manager = await as('manager');
  expect((await manager.post(`/api/purchase-orders/${order.id}/approve`)).ok()).toBe(true);
  await manager.dispose();

  const staff = await as(opts.staff);
  const received = await staff.post('/api/goods-receipts', {
    data: {
      purchaseOrderId: order.id,
      idempotencyKey: `e2e-move-receipt-${opts.storeCode}-${opts.sku}`,
      lines: [{ purchaseOrderLineId: order.lines[0]!.id, quantity }],
    },
  });
  expect(received.ok()).toBe(true);
  const number = ((await received.json()) as { number: string }).number;
  expect(number, 'the receipt carries a document number').toBeTruthy();
  await staff.dispose();
  return number;
}

/**
 * Open the movement report as one account, narrow to this test's product, and run assertions.
 * The product filter is a dropdown labelled by SKU and name; narrowing to it keeps the rows this
 * test's own, no matter how many other movements the database holds.
 */
async function onReportPage(
  browser: Browser,
  baseURL: string | undefined,
  account: AccountName,
  productLabel: string,
  run: (page: import('@playwright/test').Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ baseURL, storageState: storageState(account) });
  const page = await context.newPage();
  try {
    await page.goto('/reports/movements');
    await expect(
      page.getByRole('heading', { name: 'รายงานประวัติการเคลื่อนไหวสต็อก', level: 1 }),
    ).toBeVisible();
    // Wait for the product options to load, then narrow to this test's product.
    const productSelect = page.getByLabel('สินค้า');
    await expect(productSelect.getByRole('option', { name: productLabel })).toBeAttached();
    await productSelect.selectOption({ label: productLabel });
    await run(page);
  } finally {
    await context.close();
  }
}
