import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('products', () => {
  test.use({ storageState: storageState('admin') });

  test('an admin creates a product, is blocked from reusing a SKU or a negative price, deactivates it, and still finds it in the product search while the active-only list excludes it', async ({
    page,
  }) => {
    const sku = `E2E-${Date.now()}`; // this test's rows, nobody else's
    const name = `Workshop chair ${sku}`;

    const fillProduct = async (productSku: string, price: string) => {
      await page.getByLabel('SKU', { exact: true }).fill(productSku);
      await page.getByLabel('ชื่อ', { exact: true }).fill(name);
      await page.getByLabel('หมวดหมู่').fill('Furniture');
      await page.getByLabel('หน่วย').fill('piece');
      await page.getByLabel('ราคาขาย').fill(price);
      await page.getByLabel('จุดสั่งซื้อ B01').fill('3');
    };

    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'สินค้า', level: 1 })).toBeVisible();

    // Create it.
    await fillProduct(sku, '250');
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click();
    const row = page.getByRole('listitem').filter({ hasText: sku });
    await expect(row).toBeVisible();
    await expect(row.getByText('ใช้งาน', { exact: true })).toBeVisible();

    // Reusing the SKU is rejected, and the message names it.
    await fillProduct(sku, '250');
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click();
    await expect(page.getByRole('alert')).toContainText(sku);

    // A negative price is rejected.
    await fillProduct(`${sku}-NEG`, '-5');
    await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click();
    await expect(page.getByRole('alert')).toContainText('ไม่ติดลบ');
    await expect(page.getByRole('listitem').filter({ hasText: `${sku}-NEG` })).toHaveCount(0);

    // Deactivate it.
    await page.getByRole('button', { name: `ปิดใช้งาน ${sku}` }).click();
    await expect(row.getByText('ปิดใช้งาน', { exact: true })).toBeVisible();

    // The product search still finds it...
    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill(sku);
    await expect(row).toBeVisible();

    // ...but the active-only list, which is what new documents pick from, does not offer it.
    await page.getByLabel('สถานะ').selectOption('active');
    await expect(page.getByText('ไม่พบสินค้า')).toBeVisible();
    await expect(row).toHaveCount(0);

    // And it shows under the inactive filter.
    await page.getByLabel('สถานะ').selectOption('inactive');
    await expect(row).toBeVisible();
  });
});
