import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

/** Today's date in Asia/Bangkok as `YYYY-MM-DD` (TOR 2: dates are shown in Asia/Bangkok). */
function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

/** The Asia/Bangkok day-and-time a movement happened, for display. */
function bangkokDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** Human labels for each movement type (INV-02). */
const movementTypeLabels: Record<string, string> = {
  OPENING: 'ยอดยกมา',
  RECEIPT: 'รับเข้า',
  SALE: 'ขาย',
  ADJUSTMENT: 'ปรับปรุง',
};

/** The append-only stock ledger across all types, filtered by product, store, type and date (RPT-03). */
export function MovementReportsPage() {
  const user = useCurrentUser();
  const [productId, setProductId] = useState('');
  const [chosenStoreId, setChosenStoreId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [from, setFrom] = useState(bangkokToday);
  const [to, setTo] = useState(bangkokToday);
  // A store employee only ever sees their own store; the API enforces it too.
  const storeId = user?.storeId ?? chosenStoreId;
  const rangeIsValid = from === '' || to === '' || from <= to;

  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const report = useQuery(
    orpc.reports.movements.queryOptions({
      input: {
        page: 1,
        pageSize: 50,
        ...(productId && { productId }),
        ...(storeId && { storeId }),
        ...(movementType && {
          movementType: movementType as 'OPENING' | 'RECEIPT' | 'SALE' | 'ADJUSTMENT',
        }),
        ...(from && { from }),
        ...(to && { to }),
      },
      enabled: rangeIsValid,
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รายงานประวัติการเคลื่อนไหวสต็อก</h1>
        <p className="text-muted-foreground">
          บัญชีการเคลื่อนไหวสต็อกทุกประเภท แบ่งวันตามเวลาประเทศไทย (Asia/Bangkok)
          แต่ละรายการมีเอกสารต้นทางให้เปิดดูได้
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>การเคลื่อนไหวสต็อก</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label htmlFor="product">สินค้า</Label>
              <Input
                id="product"
                placeholder="รหัสสินค้า"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              />
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
            <div className="space-y-2">
              <Label htmlFor="type">ประเภท</Label>
              <select
                id="type"
                className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value)}
              >
                <option value="">ทั้งหมด</option>
                <option value="OPENING">ยอดยกมา</option>
                <option value="RECEIPT">รับเข้า</option>
                <option value="SALE">ขาย</option>
                <option value="ADJUSTMENT">ปรับปรุง</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">ตั้งแต่วันที่</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">ถึงวันที่</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          {!rangeIsValid ? (
            <p role="alert" className="text-destructive">
              วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด
            </p>
          ) : report.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : report.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายงานไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : report.data.items.length === 0 ? (
            <p className="text-muted-foreground">ไม่พบรายการเคลื่อนไหว</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2">
                    เวลา
                  </th>
                  <th scope="col" className="py-2">
                    สินค้า
                  </th>
                  <th scope="col" className="py-2">
                    สาขา
                  </th>
                  <th scope="col" className="py-2">
                    ประเภท
                  </th>
                  <th scope="col" className="py-2 text-right">
                    จำนวนที่เปลี่ยน
                  </th>
                  <th scope="col" className="py-2 text-right">
                    คงเหลือ
                  </th>
                  <th scope="col" className="py-2">
                    เอกสารต้นทาง
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.data.items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">{bangkokDateTime(item.createdAt)}</td>
                    <th scope="row" className="py-2 text-left font-normal">
                      {item.productSku} {item.productName}
                    </th>
                    <td className="py-2">{item.storeCode}</td>
                    <td className="py-2">
                      {movementTypeLabels[item.movementType] ?? item.movementType}
                    </td>
                    <td className="py-2 text-right">
                      {item.quantityChange > 0 ? `+${item.quantityChange}` : item.quantityChange}
                    </td>
                    <td className="py-2 text-right">{item.balanceAfter}</td>
                    <td className="py-2">{item.sourceDocumentNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
