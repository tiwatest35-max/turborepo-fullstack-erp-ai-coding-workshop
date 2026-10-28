import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORPCError } from '@orpc/client';
import { useState } from 'react';
import type { ReceivableOrder } from '@erp/contracts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orpc } from '@/lib/orpc';

/** The server's Thai message when it sent one; otherwise a generic receive failure. */
function errorMessage(error: unknown): string {
  if (error instanceof ORPCError) {
    const data = error.data as { messageTh?: unknown } | undefined;
    if (typeof data?.messageTh === 'string') return data.messageTh;
  }
  return 'รับสินค้าไม่สำเร็จ โปรดลองอีกครั้ง';
}

/** Receiving screen (GR-01): the store employee's receivable orders, received quantities per line. */
export function ReceivingPage() {
  const queryClient = useQueryClient();
  const orders = useQuery(
    orpc.goodsReceipts.receivable.queryOptions({ input: { page: 1, pageSize: 20 } }),
  );

  // Typed received quantity per purchase-order line, keyed by line id.
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const setQuantity = (lineId: string, value: string) =>
    setQuantities((q) => ({ ...q, [lineId]: value }));

  const confirm = useMutation(
    orpc.goodsReceipts.confirm.mutationOptions({
      onSuccess: () => {
        setQuantities({});
        void queryClient.invalidateQueries({ queryKey: orpc.goodsReceipts.receivable.key() });
      },
    }),
  );

  const submit = (order: ReceivableOrder) => {
    const lines = order.lines
      .map((line) => ({
        purchaseOrderLineId: line.id,
        quantity: Number(quantities[line.id] ?? ''),
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    confirm.mutate({
      purchaseOrderId: order.id,
      // A fresh key per submit; a retry of the same click reuses it to avoid double-receiving (GR-04).
      idempotencyKey: crypto.randomUUID(),
      lines,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">รับสินค้า</h1>
        <p className="text-muted-foreground">
          รับสินค้าเข้าตามใบสั่งซื้อที่อนุมัติแล้วของสาขาที่ได้รับมอบหมาย
        </p>
      </div>

      {confirm.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(confirm.error)}
        </p>
      )}

      {orders.isPending ? (
        <p className="text-muted-foreground">กำลังโหลด…</p>
      ) : orders.isError ? (
        <p role="alert" className="text-destructive">
          โหลดรายการไม่สำเร็จ โปรดลองอีกครั้ง
        </p>
      ) : orders.data.items.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีใบสั่งซื้อที่รอรับ</p>
      ) : (
        <div className="space-y-4">
          {orders.data.items.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{order.number}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {order.supplierCode} → {order.storeCode} · รับวันที่ {order.expectedReceiptDate}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-3">
                  {order.lines.map((line) => (
                    <li
                      key={line.id}
                      className="grid grid-cols-[2fr_1fr] items-end gap-3 border-b pb-3 last:border-0"
                    >
                      <div>
                        <p className="font-medium">
                          {line.sku} {line.productName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          สั่ง {line.ordered} · รับแล้ว {line.received} · คงเหลือ {line.outstanding}{' '}
                          {line.unit}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`qty-${line.id}`}>รับ {line.sku}</Label>
                        <Input
                          id={`qty-${line.id}`}
                          type="number"
                          min={0}
                          max={line.outstanding}
                          value={quantities[line.id] ?? ''}
                          onChange={(e) => setQuantity(line.id, e.target.value)}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  aria-label={`ยืนยันการรับสินค้า ${order.number}`}
                  disabled={confirm.isPending}
                  onClick={() => submit(order)}
                >
                  {confirm.isPending ? 'กำลังบันทึก…' : 'ยืนยันการรับสินค้า'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
