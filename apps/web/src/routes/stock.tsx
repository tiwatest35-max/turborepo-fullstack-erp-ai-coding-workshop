import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { StockMovementType } from '@erp/contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  OPENING: 'ยอดยกมา',
  RECEIPT: 'รับสินค้า',
  SALE: 'ขาย',
  ADJUSTMENT: 'ปรับสต็อก',
};

/** Dates are shown in Asia/Bangkok (TOR Section 2). */
const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(iso));

/** Search stock by SKU, product name and store, and read the movement ledger behind it. */
export function StockPage() {
  const user = useCurrentUser();
  const [search, setSearch] = useState('');
  const [chosenStoreId, setChosenStoreId] = useState('');
  // A store employee only ever sees their own store; the API enforces it too.
  const storeId = user?.storeId ?? chosenStoreId;
  const term = search.trim();

  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  const stock = useQuery(
    orpc.stock.search.queryOptions({
      input: { page: 1, pageSize: 20, ...(term && { search: term }), ...(storeId && { storeId }) },
    }),
  );
  const movements = useQuery(
    orpc.stock.movements.queryOptions({
      input: { page: 1, pageSize: 20, ...(storeId && { storeId }) },
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">สต็อก</h1>
        <p className="text-muted-foreground">
          ค้นหาจำนวนคงเหลือตาม SKU ชื่อสินค้า และสาขา พร้อมประวัติการเคลื่อนไหวสต็อก
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>สต็อกคงเหลือ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
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

          {stock.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : stock.isError ? (
            <p role="alert" className="text-destructive">
              โหลดสต็อกไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : stock.data.items.length === 0 ? (
            <p className="text-muted-foreground">ไม่พบสต็อกที่ตรงกับการค้นหา</p>
          ) : (
            <ul className="divide-y">
              {stock.data.items.map((level) => (
                <li
                  key={`${level.productId}:${level.storeId}`}
                  className="flex items-center justify-between py-2"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{level.productName}</span>
                    <span className="text-muted-foreground">{level.sku}</span>
                    <span className="text-muted-foreground">{level.storeCode}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span>{`คงเหลือ ${level.quantity} ${level.unit}`}</span>
                    <span className="text-muted-foreground">
                      {level.reorderThreshold === null
                        ? 'ไม่ได้ตั้งจุดสั่งซื้อ'
                        : `จุดสั่งซื้อ ${level.reorderThreshold}`}
                    </span>
                    {level.lowStock && <Badge variant="destructive">สต็อกต่ำ</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ประวัติการเคลื่อนไหวสต็อก</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            รายการที่ยืนยันแล้วแก้ไขหรือลบไม่ได้ ใหม่สุดอยู่บนสุด
          </p>
          {movements.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : movements.isError ? (
            <p role="alert" className="text-destructive">
              โหลดประวัติไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : movements.data.items.length === 0 ? (
            <p className="text-muted-foreground">ยังไม่มีการเคลื่อนไหวสต็อก</p>
          ) : (
            <ul className="divide-y">
              {movements.data.items.map((movement) => (
                <li key={movement.id} className="flex items-center justify-between py-2">
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{MOVEMENT_LABEL[movement.movementType]}</span>
                    <span className="text-muted-foreground">{movement.productSku}</span>
                    <span className="text-muted-foreground">{movement.storeCode}</span>
                    {movement.sourceDocumentNumber && (
                      <span className="text-muted-foreground">
                        เอกสาร {movement.sourceDocumentNumber}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span>
                      {movement.quantityChange > 0
                        ? `+${movement.quantityChange}`
                        : movement.quantityChange}
                    </span>
                    <span className="text-muted-foreground">
                      {`ก่อน ${movement.balanceBefore} หลัง ${movement.balanceAfter}`}
                    </span>
                    <span className="text-muted-foreground">{movement.actorName}</span>
                    <span className="text-muted-foreground">{formatTime(movement.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
