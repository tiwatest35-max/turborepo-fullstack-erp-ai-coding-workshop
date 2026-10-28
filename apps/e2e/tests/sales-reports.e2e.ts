import { expect, test } from '@playwright/test';
import { storageState } from './accounts.js';

test.describe('sales reports', () => {
  test.use({ storageState: storageState('manager') });

  // The second half of the ticket's Demo line (a sale just before Bangkok midnight falls on the
  // right day) cannot be driven from the browser: the server stamps the confirmation time. The
  // API integration spec for the report covers it at the exact instants.
  test('selecting a day with no sales shows zero totals and an empty-state message', async ({
    page,
  }) => {
    await page.goto('/reports/sales');
    await expect(page.getByRole('heading', { name: 'รายงานยอดขายรายวัน', level: 1 })).toBeVisible();

    // No test or seed sells anything on this day.
    await page.getByLabel('ตั้งแต่วันที่').fill('2020-01-01');
    await page.getByLabel('ถึงวันที่').fill('2020-01-01');

    await expect(page.getByText('ไม่พบการขายในช่วงวันที่ที่เลือก')).toBeVisible();
    await expect(page.getByText('จำนวนเอกสาร')).toBeVisible();
    // Document count and units sold are 0; the total is 0.00 (two decimal places).
    await expect(page.getByText('0', { exact: true })).toHaveCount(2);
    await expect(page.getByText('0.00', { exact: true })).toBeVisible();
  });
});
