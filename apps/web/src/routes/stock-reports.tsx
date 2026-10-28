import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ExportCsvButton } from '@/components/export-csv-button';
import { StockLevelList } from '@/components/stock-level-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { downloadCsv } from '@/lib/download-csv';
import { orpc } from '@/lib/orpc';

type Report = 'ON_HAND' | 'LOW_STOCK';

const REPORTS: { value: Report; label: string }[] = [
  { value: 'ON_HAND', label: 'สต็อกคงเหลือ' },
  { value: 'LOW_STOCK', label: 'สต็อกต่ำ' },
];

/** Stock on hand and low stock by store, with product search (RPT-02). */
export function StockReportsPage() {
  const user = useCurrentUser();
  const [report, setReport] = useState<Report>('ON_HAND');
  const [search, setSearch] = useState('');
  const [chosenStoreId, setChosenStoreId] = useState('');
  // A store employee only ever sees their own store; the API enforces it too.
  const storeId = user?.storeId ?? chosenStoreId;
  const term = search.trim();

  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const filters = {
    ...(term && { search: term }),
    ...(storeId && { storeId }),
    ...(report === 'LOW_STOCK' && { lowStockOnly: true }),
  };
  const stock = useQuery(
    orpc.stock.search.queryOptions({ input: { page: 1, pageSize: 100, ...filters } }),
  );
  const exportCsv = useMutation(orpc.stock.exportCsv.mutationOptions({ onSuccess: downloadCsv }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รายงานสต็อก</h1>
        <p className="text-muted-foreground">
          สต็อกคงเหลือและสินค้าที่ต่ำกว่าจุดสั่งซื้อ แยกตามสาขา
          สินค้าที่ไม่มีสต็อกยังแสดงเมื่อตรงกับการค้นหา
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{REPORTS.find((r) => r.value === report)?.label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">รายงาน</legend>
              <div className="flex h-9 items-center gap-4">
                {REPORTS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="report"
                      value={option.value}
                      checked={report === option.value}
                      onChange={() => setReport(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="search">ค้นหา SKU หรือชื่อ</Label>
              <Input id="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="store">สาขา</Label>
              <select
                id="store"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={storeId}
                disabled={Boolean(user?.storeId)}
                onChange={(e) => setChosenStoreId(e.target.value)}
              >
                <option value="">ทั้งหมด</option>
                {stores.data?.items.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.code} {store.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <ExportCsvButton
            onExport={() => exportCsv.mutate(filters)}
            pending={exportCsv.isPending}
            failed={exportCsv.isError}
          />

          {stock.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : stock.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายงานไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : stock.data.items.length === 0 ? (
            <p className="text-muted-foreground">ไม่พบสต็อกที่ตรงกับการค้นหา</p>
          ) : (
            <StockLevelList levels={stock.data.items} />
          )}
          {stock.data?.hasMore && (
            <p className="text-sm text-muted-foreground">
              แสดง {stock.data.items.length} จาก {stock.data.total} รายการ
              ใช้การค้นหาหรือเลือกสาขาเพื่อดูรายการอื่น
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
