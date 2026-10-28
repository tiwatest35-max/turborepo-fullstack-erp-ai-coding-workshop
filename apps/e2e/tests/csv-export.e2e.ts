import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import { storageState } from './accounts.js';

/** The bytes of a download, split into the first three (the byte-order mark) and the UTF-8 text. */
async function readCsv(download: Download) {
  const bytes = await readFile(await download.path());
  return { bom: [...bytes.subarray(0, 3)], text: bytes.subarray(3).toString('utf8') };
}
const UTF8_BYTE_ORDER_MARK = [0xef, 0xbb, 0xbf];

test.describe('csv export', () => {
  test.use({ storageState: storageState('admin') });

  test('export the sales and stock reports with Thai product names rendering correctly; a product named with a leading equals sign is exported as inert text, not a formula', async ({
    page,
    request,
  }) => {
    const stamp = `E2E${Date.now()}`;
    const thaiName = 'น้ำดื่มตราช้าง';
    for (const [sku, name] of [
      [`${stamp}A`, thaiName],
      [`${stamp}B`, '=1+1'],
    ]) {
      const created = await request.post('/api/products', {
        data: { sku, name, category: 'E2E', unit: 'ขวด', sellingPrice: 10 },
      });
      expect(created.ok()).toBe(true);
    }

    // Stock report: filtered to this test's two products, exactly as on screen.
    await page.goto('/reports/stock');
    await page.getByLabel('ค้นหา SKU หรือชื่อ').fill(stamp);
    await page.getByLabel('สาขา').selectOption({ label: 'B01 Central Store' });
    await expect(page.getByRole('listitem').filter({ hasText: thaiName })).toHaveCount(1);

    const stockDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออก CSV' }).click();
    const stock = await readCsv(await stockDownload);

    expect(stock.bom).toEqual(UTF8_BYTE_ORDER_MARK);
    expect(stock.text).toContain(`${stamp}A,${thaiName},ขวด,B01,Central Store,0,`);
    // The leading equals sign is neutralized: the cell is text, not a formula.
    expect(stock.text).toContain(`${stamp}B,'=1+1,ขวด,B01,Central Store,0,`);
    expect(stock.text).not.toMatch(/,=1\+1/);

    // Sales report: the Thai header survives, with a total row even when nothing was sold.
    await page.goto('/reports/sales');
    await page.getByLabel('ตั้งแต่วันที่').fill('2020-01-01');
    await page.getByLabel('ถึงวันที่').fill('2020-01-01');
    await expect(page.getByText('ไม่พบการขายในช่วงวันที่ที่เลือก')).toBeVisible();

    const salesDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออก CSV' }).click();
    const download = await salesDownload;
    const sales = await readCsv(download);

    expect(download.suggestedFilename()).toBe('sales-daily_2020-01-01_2020-01-01.csv');
    expect(sales.bom).toEqual(UTF8_BYTE_ORDER_MARK);
    expect(sales.text).toBe('วันที่,จำนวนเอกสาร,จำนวนชิ้น,ยอดขาย (บาท)\r\nรวม,0,0,0.00\r\n');
  });
});
