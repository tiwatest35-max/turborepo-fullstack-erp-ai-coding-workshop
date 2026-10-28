import { expect, test, type APIRequestContext } from '@playwright/test';
import { storageState } from './accounts.js';

type Page<T> = { items: T[] };
type Order = { id: string; number: string };

test.describe('purchase order approval', () => {
  test.use({ storageState: storageState('manager') });

  test('manager01 approves a submitted PO (now frozen), rejects another with a reason, and an attempt to approve an already-approved order is refused; audit rows exist for the approval and rejection', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const sku = `E2E-APPROVAL-${Date.now()}`;
    const as = (name: 'admin' | 'buyer' | 'manager') =>
      playwright.request.newContext({ baseURL, storageState: storageState(name) });

    // Data: one product, and two orders submitted by buyer01 against SUP01 for B01.
    const admin = await as('admin');
    const product = await admin.post('/api/products', {
      data: {
        sku,
        name: `Workshop item ${sku}`,
        category: 'Furniture',
        unit: 'piece',
        sellingPrice: 100,
      },
    });
    expect(product.ok()).toBe(true);
    const productId = ((await product.json()) as { id: string }).id;
    await admin.dispose();

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
    const supplierId = await idOf('suppliers', 'SUP01');
    const storeId = await idOf('stores', 'B01');
    const submitOrder = async (quantity: number) => {
      const created = await buyer.post('/api/purchase-orders', {
        data: {
          supplierId,
          storeId,
          expectedReceiptDate: '2026-12-01',
          lines: [{ productId, quantity, unitPrice: 45 }],
        },
      });
      expect(created.ok()).toBe(true);
      const order = (await created.json()) as Order;
      const submitted = await buyer.post(`/api/purchase-orders/${order.id}/submit`);
      expect(submitted.ok()).toBe(true);
      return order;
    };
    const toApprove = await submitOrder(2);
    const toReject = await submitOrder(3);
    await buyer.dispose();

    await page.goto('/purchase-orders');
    await expect(page.getByRole('heading', { name: 'ใบสั่งซื้อ', level: 1 })).toBeVisible();
    // Scope to the purchase-order list: the audit log below is also a list of listitems that
    // mention the same order numbers and reason, so matching the whole page is ambiguous.
    // Match the number exactly too: a plain substring would also catch PO-0000040 for PO-000004.
    const exactNumber = (number: string) => new RegExp(`${number}(?!\\d)`);
    const orderList = page.getByRole('list', { name: 'รายการใบสั่งซื้อ' });
    const orderRow = (order: Order) =>
      orderList.getByRole('listitem').filter({ hasText: exactNumber(order.number) });

    // Approve: Approved, and nothing is left to do to it.
    const approving = orderRow(toApprove);
    await approving
      .getByRole('button', { name: `อนุมัติ ${toApprove.number}`, exact: true })
      .click();
    await expect(approving.getByText('อนุมัติแล้ว', { exact: true })).toBeVisible();
    await expect(approving.getByText('อนุมัติโดย Manager 01')).toBeVisible();
    await expect(approving.getByRole('button')).toHaveCount(0);

    // Reject needs a reason; with one, the order is Rejected and stays on the list.
    const rejecting = orderRow(toReject);
    await rejecting.getByRole('button', { name: `ไม่อนุมัติ ${toReject.number}` }).click();
    await expect(page.getByRole('alert')).toContainText('ต้องระบุเหตุผล');
    await rejecting.getByLabel(`เหตุผล ${toReject.number}`).fill('ราคาสูงกว่าใบเสนอราคา');
    await rejecting.getByRole('button', { name: `ไม่อนุมัติ ${toReject.number}` }).click();
    await expect(rejecting.getByText('ไม่อนุมัติ', { exact: true })).toBeVisible();
    await expect(rejecting.getByText('เหตุผล: ราคาสูงกว่าใบเสนอราคา')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Approving the already-approved order again is refused at the API, and it stays Approved.
    const manager = await as('manager');
    const again = await manager.post(`/api/purchase-orders/${toApprove.id}/approve`);
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { data: { code: string } }).data.code).toBe(
      'PO_INVALID_TRANSITION',
    );
    await expectAuditRows(manager, toApprove, toReject);
    await manager.dispose();
    await page.reload();
    await expect(orderRow(toApprove).getByText('อนุมัติแล้ว', { exact: true })).toBeVisible();

    // The audit log on the page: one row for each, and none for the refused attempt.
    const audit = page.getByRole('list', { name: 'บันทึกการตรวจสอบ' });
    await expect(
      audit.getByRole('listitem').filter({ hasText: exactNumber(toApprove.number) }),
    ).toHaveCount(1);
    await expect(
      audit
        .getByRole('listitem')
        .filter({ hasText: exactNumber(toReject.number) })
        .getByText('เหตุผล: ราคาสูงกว่าใบเสนอราคา'),
    ).toBeVisible();
  });

  test('a purchasing officer cannot approve, enforced at the API', async ({
    playwright,
    baseURL,
  }) => {
    const buyer = await playwright.request.newContext({
      baseURL,
      storageState: storageState('buyer'),
    });

    const response = await buyer.post('/api/purchase-orders/anything/approve');
    expect(response.status()).toBe(403);
    expect((await buyer.get('/api/audit-log')).status()).toBe(403);
    await buyer.dispose();
  });
});

/** The audit log has one APPROVED row and one REJECTED row for these two orders. */
async function expectAuditRows(manager: APIRequestContext, approved: Order, rejected: Order) {
  const response = await manager.get('/api/audit-log?page=1&pageSize=100');
  expect(response.ok()).toBe(true);
  const items = (
    (await response.json()) as Page<{
      sourceDocumentNumber: string;
      outcome: string;
      actorName: string;
      reason: string | null;
    }>
  ).items;

  const forApproved = items.filter((entry) => entry.sourceDocumentNumber === approved.number);
  const forRejected = items.filter((entry) => entry.sourceDocumentNumber === rejected.number);
  expect(forApproved).toEqual([
    expect.objectContaining({ outcome: 'APPROVED', actorName: 'Manager 01', reason: null }),
  ]);
  expect(forRejected).toEqual([
    expect.objectContaining({
      outcome: 'REJECTED',
      actorName: 'Manager 01',
      reason: 'ราคาสูงกว่าใบเสนอราคา',
    }),
  ]);
}
