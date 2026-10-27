import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('stock reports', () => {
  test.use({ storageState: storageState('admin') });

  test('the B01 low-stock report lists SKU003 because its balance of 0 is at or below its threshold of 3; a zero-stock product still appears when it matches the search', async ({
    page,
  }) => {
    await page.goto('/reports/stock');
    await expect(page.getByRole('heading', { name: 'รายงานสต็อก', level: 1 })).toBeVisible();

    await page.getByLabel('สาขา').selectOption({ label: 'B01 Central Store' });

    // Stock on hand lists every product in B01, including the zero-stock one.
    const water = page.getByRole('listitem').filter({ hasText: 'Drinking water pack of 6' });
    const detergent = page.getByRole('listitem').filter({ hasText: 'Laundry detergent' });
    await expect(water).toHaveCount(1);
    await expect(detergent).toHaveCount(1);

    // The low-stock report keeps SKU003 (0 <= 3) and drops the products above their threshold.
    await page.getByRole('radio', { name: 'สต็อกต่ำ' }).check();
    await expect(detergent).toHaveCount(1);
    await expect(detergent.getByText('คงเหลือ 0 bag')).toBeVisible();
    await expect(detergent.getByText('จุดสั่งซื้อ 3')).toBeVisible();
    await expect(detergent.getByText('สต็อกต่ำ')).toBeVisible();
    await expect(water).toHaveCount(0);

    // A zero-stock product stays visible when it matches the search.
    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill('SKU003');
    await expect(detergent).toHaveCount(1);
    await expect(detergent.getByText('คงเหลือ 0 bag')).toBeVisible();

    // A search that does not match it hides it.
    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill('SKU001');
    await expect(page.getByText('ไม่พบสต็อกที่ตรงกับการค้นหา')).toBeVisible();
    await expect(detergent).toHaveCount(0);
  });
});
