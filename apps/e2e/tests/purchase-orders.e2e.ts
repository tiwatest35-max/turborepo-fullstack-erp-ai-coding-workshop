import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('purchase orders', () => {
  test.use({ storageState: storageState('buyer') });

  test('buyer01 drafts a PO against SUP01 for B01, edits it, and submits it; duplicate SKU, negative price, and an inactive product line are rejected', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const suffix = Date.now();
    const sku = `E2E-PO-${suffix}`;
    const inactiveSku = `E2E-PO-OFF-${suffix}`;

    // Products are admin's to create (MD-01). This test makes its own: one to order, one switched off.
    const admin = await playwright.request.newContext({
      baseURL,
      storageState: storageState('admin'),
    });
    const makeProduct = async (productSku: string) => {
      const created = await admin.post('/api/products', {
        data: {
          sku: productSku,
          name: `Workshop item ${productSku}`,
          category: 'Furniture',
          unit: 'piece',
          sellingPrice: 100,
        },
      });
      expect(created.ok()).toBe(true);
      return ((await created.json()) as { id: string }).id;
    };
    await makeProduct(sku);
    const inactiveId = await makeProduct(inactiveSku);
    const deactivated = await admin.patch(`/api/products/${inactiveId}`, {
      data: { active: false },
    });
    expect(deactivated.ok()).toBe(true);
    await admin.dispose();

    await page.goto('/purchase-orders');
    await expect(page.getByRole('heading', { name: 'ใบสั่งซื้อ', level: 1 })).toBeVisible();

    // Scope alert assertions to the create/edit form. The list card renders its own
    // alert when its query fails, so `getByRole('alert')` page-wide is ambiguous.
    const form = page.locator('form');
    const formAlert = form.getByRole('alert');

    // An inactive product is still listed in the picker, marked as such; the API refuses it.
    const optionLabel = (productSku: string) =>
      `${productSku} Workshop item ${productSku}${productSku === inactiveSku ? ' (ปิดใช้งาน)' : ''}`;
    const fillLine = async (n: number, productSku: string, quantity: string, price: string) => {
      await page
        .getByLabel(`สินค้า รายการที่ ${n}`)
        .selectOption({ label: optionLabel(productSku) });
      await page.getByLabel(`จำนวน รายการที่ ${n}`).fill(quantity);
      await page.getByLabel(`ราคาต่อหน่วย รายการที่ ${n}`).fill(price);
    };

    // Draft it against SUP01 for B01.
    await page.getByLabel('ผู้จัดจำหน่าย').selectOption({ label: 'SUP01 SupplyOne Co Ltd' });
    await page.getByLabel('สาขาปลายทาง').selectOption({ label: 'B01 Central Store' });
    await page.getByLabel('วันที่คาดว่าจะได้รับ').fill('2026-12-01');

    // The same SKU twice in one order is rejected.
    await fillLine(1, sku, '2', '45');
    await page.getByRole('button', { name: 'เพิ่มรายการสินค้า' }).click();
    await fillLine(2, sku, '1', '10');
    await page.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
    await expect(formAlert).toContainText('ห้ามซ้ำ');
    await page.getByRole('button', { name: 'ลบรายการที่ 2' }).click();

    // A negative price is rejected.
    await fillLine(1, sku, '2', '-1');
    await page.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
    await expect(formAlert).toContainText('ไม่ติดลบ');

    // An inactive product is rejected, and the message names its SKU.
    await fillLine(1, inactiveSku, '2', '45');
    await page.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
    await expect(formAlert).toContainText(inactiveSku);

    // Nothing was saved by any of the three.
    await expect(page.getByRole('listitem').filter({ hasText: sku })).toHaveCount(0);

    // A valid draft saves, and shows its line and total.
    await fillLine(1, sku, '2', '45');
    await page.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
    const order = page.getByRole('listitem').filter({ hasText: sku });
    await expect(order).toBeVisible();
    await expect(order.getByText('ฉบับร่าง', { exact: true })).toBeVisible();
    await expect(order.getByText('รวม 90.00')).toBeVisible();

    // Edit the draft: three pieces instead of two.
    await order.getByRole('button', { name: /^แก้ไข PO-/ }).click();
    await page.getByLabel('จำนวน รายการที่ 1').fill('3');
    await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await expect(order.getByText('รวม 135.00')).toBeVisible();
    await expect(order.getByText('ฉบับร่าง', { exact: true })).toBeVisible();

    // Submit it: Pending Approval, and it can no longer be edited or submitted again.
    await order.getByRole('button', { name: /^ส่งอนุมัติ PO-/ }).click();
    await expect(order.getByText('รออนุมัติ', { exact: true })).toBeVisible();
    await expect(order.getByRole('button', { name: /^(แก้ไข|ส่งอนุมัติ) PO-/ })).toHaveCount(0);
  });
});
