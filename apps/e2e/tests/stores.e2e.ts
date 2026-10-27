import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('stores', () => {
  test.use({ storageState: storageState('admin') });

  test('an admin creates and edits a store and it appears in the store list', async ({ page }) => {
    const code = `E${Date.now()}`; // this test's row, nobody else's
    const name = `Harbour Store ${code}`;
    const renamed = `Harbour Plaza ${code}`;

    await page.goto('/stores');
    await expect(page.getByRole('heading', { name: 'สาขา', level: 1 })).toBeVisible();

    await page.getByLabel('รหัส').fill(code);
    await page.getByLabel('ชื่อ', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'เพิ่มสาขา' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();

    await page.getByRole('button', { name: `แก้ไข ${code}` }).click();
    await page.getByLabel('ชื่อ (แก้ไข)').fill(renamed);
    await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();

    await expect(page.getByRole('listitem').filter({ hasText: renamed })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  });

  test('a duplicate store code is rejected with an alert', async ({ page }) => {
    await page.goto('/stores');

    // B01 is a seeded store.
    await page.getByLabel('รหัส').fill('B01');
    await page.getByLabel('ชื่อ', { exact: true }).fill('Duplicate of B01');
    await page.getByRole('button', { name: 'เพิ่มสาขา' }).click();

    await expect(page.getByRole('alert')).toContainText('เพิ่มสาขาไม่สำเร็จ');
  });
});

test.describe('stores as a store employee', () => {
  test.use({ storageState: storageState('staff') });

  test('a non-admin sees the list but no add or edit controls', async ({ page }) => {
    await page.goto('/stores');

    // B01 is a seeded store.
    await expect(page.getByRole('listitem').filter({ hasText: 'B01' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'เพิ่มสาขา' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'แก้ไข B01' })).toHaveCount(0);
  });
});
