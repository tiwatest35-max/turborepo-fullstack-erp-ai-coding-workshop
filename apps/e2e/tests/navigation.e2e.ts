import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

// Every page is reachable from the top navigation. This walks the menu to a few pages,
// including the movement-history report, and checks the heading and the URL.
test.describe('navigation', () => {
  test.use({ storageState: storageState('manager') });

  test('the top menu links to the pages, including the movement-history report', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'เมนูหลัก' });
    await expect(nav).toBeVisible();

    await nav.getByRole('link', { name: 'สินค้า', exact: true }).click();
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByRole('heading', { name: 'สินค้า', level: 1 })).toBeVisible();

    await nav.getByRole('link', { name: 'รายงานการเคลื่อนไหว', exact: true }).click();
    await expect(page).toHaveURL(/\/reports\/movements$/);
    await expect(
      page.getByRole('heading', { name: 'รายงานประวัติการเคลื่อนไหวสต็อก', level: 1 }),
    ).toBeVisible();

    await nav.getByRole('link', { name: 'ใบสั่งซื้อ', exact: true }).click();
    await expect(page).toHaveURL(/\/purchase-orders$/);
    await expect(page.getByRole('heading', { name: 'ใบสั่งซื้อ', level: 1 })).toBeVisible();
  });
});
