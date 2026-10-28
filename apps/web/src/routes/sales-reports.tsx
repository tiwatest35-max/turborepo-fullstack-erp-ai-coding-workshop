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

/** THB with two decimal places (TOR 6.2). */
const baht = (amount: number) =>
  amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Daily sales by Asia/Bangkok day, filtered by date range and store (RPT-01). */
export function SalesReportsPage() {
  const user = useCurrentUser();
  const [from, setFrom] = useState(bangkokToday);
  const [to, setTo] = useState(bangkokToday);
  const [chosenStoreId, setChosenStoreId] = useState('');
  // A store employee only ever sees their own store; the API enforces it too.
  const storeId = user?.storeId ?? chosenStoreId;
  const rangeIsValid = from !== '' && to !== '' && from <= to;

  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const report = useQuery(
    orpc.reports.dailySales.queryOptions({
      input: { from, to, ...(storeId && { storeId }) },
      enabled: rangeIsValid,
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รายงานยอดขายรายวัน</h1>
        <p className="text-muted-foreground">
          เฉพาะการขายที่ยืนยันแล้ว แบ่งวันตามเวลาประเทศไทย (Asia/Bangkok) ตั้งแต่ 00:00:00 ถึงก่อน
          00:00:00 ของวันถัดไป
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ยอดขาย</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label htmlFor="from">ตั้งแต่วันที่</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">ถึงวันที่</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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

          {!rangeIsValid ? (
            <p role="alert" className="text-destructive">
              เลือกวันที่เริ่มต้นและวันที่สิ้นสุดให้ถูกต้อง วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด
            </p>
          ) : report.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : report.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายงานไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-sm text-muted-foreground">จำนวนเอกสาร</dt>
                  <dd className="text-xl font-semibold">{report.data.totals.documentCount}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">จำนวนชิ้นที่ขาย</dt>
                  <dd className="text-xl font-semibold">{report.data.totals.unitsSold}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">ยอดขายรวม (บาท)</dt>
                  <dd className="text-xl font-semibold">{baht(report.data.totals.totalSales)}</dd>
                </div>
              </dl>
              {report.data.days.length === 0 ? (
                <p className="text-muted-foreground">ไม่พบการขายในช่วงวันที่ที่เลือก</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th scope="col" className="py-2">
                        วันที่
                      </th>
                      <th scope="col" className="py-2 text-right">
                        จำนวนเอกสาร
                      </th>
                      <th scope="col" className="py-2 text-right">
                        จำนวนชิ้น
                      </th>
                      <th scope="col" className="py-2 text-right">
                        ยอดขาย (บาท)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.days.map((day) => (
                      <tr key={day.date} className="border-b">
                        <th scope="row" className="py-2 text-left font-normal">
                          {day.date}
                        </th>
                        <td className="py-2 text-right">{day.documentCount}</td>
                        <td className="py-2 text-right">{day.unitsSold}</td>
                        <td className="py-2 text-right">{baht(day.totalSales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
