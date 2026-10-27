import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('stock', () => {
  test.use({ storageState: storageState('admin') });

  test('search stock by SKU and store and see quantity, unit, threshold, and low-stock flag; a seeded movement is visible and cannot be edited', async ({
    page,
    request,
  }) => {
    await page.goto('/stock');
    await expect(page.getByRole('heading', { name: 'สต็อก', level: 1 })).toBeVisible();

    // Search SKU001 in B01: 10 packs against a threshold of 3, so not low.
    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill('SKU001');
    await page.getByLabel('สาขา').selectOption({ label: 'B01 Central Store' });
    const water = page.getByRole('listitem').filter({ hasText: 'Drinking water pack of 6' });
    await expect(water).toHaveCount(1);
    await expect(water.getByText('คงเหลือ 10 pack')).toBeVisible();
    await expect(water.getByText('จุดสั่งซื้อ 3')).toBeVisible();
    await expect(water.getByText('สต็อกต่ำ')).toHaveCount(0);

    // SKU003 in B01 has 0 bags, at or below the threshold of 3: flagged as low stock.
    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill('SKU003');
    const detergent = page.getByRole('listitem').filter({ hasText: 'Laundry detergent' });
    await expect(detergent.getByText('คงเหลือ 0 bag')).toBeVisible();
    await expect(detergent.getByText('จุดสั่งซื้อ 3')).toBeVisible();
    await expect(detergent.getByText('สต็อกต่ำ')).toBeVisible();

    // The seeded opening movement of SKU001 in B01 is in the history, with no edit or delete control.
    const opening = page
      .getByRole('listitem')
      .filter({ hasText: 'ยอดยกมา' })
      .filter({ hasText: 'SKU001' });
    await expect(opening).toBeVisible();
    await expect(opening.getByText('+10')).toBeVisible();
    await expect(opening.getByText('ก่อน 0 หลัง 10')).toBeVisible();
    await expect(opening.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /แก้ไข|ลบ/ })).toHaveCount(0);

    // Asking the API to change it anyway is refused, and the movement is still there.
    const list = await request.get('/api/stock/movements?pageSize=100');
    const { items } = (await list.json()) as { items: { id: string; productSku: string }[] };
    const seeded = items.find((movement) => movement.productSku === 'SKU001');
    expect(seeded).toBeDefined();
    for (const method of ['patch', 'put', 'delete'] as const) {
      const response = await request[method](`/api/stock/movements/${seeded!.id}`, { data: {} });
      expect(response.ok()).toBe(false);
    }
    await page.reload();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'ยอดยกมา' }).filter({ hasText: 'SKU001' }),
    ).toBeVisible();
  });
});

test.describe('stock as a store employee', () => {
  test.use({ storageState: storageState('staff') });

  test('a store employee sees only their own store, and the API refuses another', async ({
    page,
    request,
  }) => {
    await page.goto('/stock');
    await expect(page.getByLabel('สาขา')).toBeDisabled();

    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill('SKU001');
    const rows = page.getByRole('listitem').filter({ hasText: 'Drinking water pack of 6' });
    await expect(rows).toHaveCount(1);
    await expect(rows.getByText('B01', { exact: true })).toBeVisible();

    // staff_b01 is bound to B01: another store's id is refused (NFR-01).
    const stores = await request.get('/api/stores');
    const { items } = (await stores.json()) as { items: { id: string; code: string }[] };
    const b02 = items.find((store) => store.code === 'B02');
    const refused = await request.get(`/api/stock?storeId=${b02!.id}`);
    expect(refused.status()).toBe(403);
  });
});
