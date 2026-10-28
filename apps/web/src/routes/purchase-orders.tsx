import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORPCError } from '@orpc/client';
import { type FormEvent, useState } from 'react';
import type { AuditOutcome, PurchaseOrder, PurchaseOrderStatus } from '@erp/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCurrentUser } from '@/lib/auth';
import { orpc } from '@/lib/orpc';

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'ฉบับร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  PARTIALLY_RECEIVED: 'รับของบางส่วน',
  COMPLETED: 'เสร็จสมบูรณ์',
  REJECTED: 'ไม่อนุมัติ',
  CANCELLED: 'ยกเลิก',
};

/** Who decided, said the way each decision reads: "approved by", "rejected by", "cancelled by". */
const DECIDED_BY_LABEL: Partial<Record<PurchaseOrderStatus, string>> = {
  APPROVED: 'อนุมัติโดย',
  REJECTED: 'ไม่อนุมัติโดย',
  CANCELLED: 'ยกเลิกโดย',
};

const OUTCOME_LABEL: Record<AuditOutcome, string> = {
  APPROVED: 'อนุมัติ',
  REJECTED: 'ไม่อนุมัติ',
};

/** A line while it is being typed: numbers stay text until the form is sent. */
type LineDraft = { productId: string; quantity: string; unitPrice: string };

const emptyLine = (): LineDraft => ({ productId: '', quantity: '', unitPrice: '' });

const selectClass = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';

const money = (amount: number) => amount.toFixed(2);

/** The server's Thai message when it sent one; otherwise a message for rejected input. */
function errorMessage(error: unknown): string {
  if (error instanceof ORPCError) {
    const data = error.data as { messageTh?: unknown } | undefined;
    if (typeof data?.messageTh === 'string') return data.messageTh;
    if (error.code === 'BAD_REQUEST') {
      return 'ข้อมูลไม่ถูกต้อง จำนวนต้องเป็นจำนวนเต็มบวก ราคาต้องไม่ติดลบ สินค้าห้ามซ้ำกันในใบเดียว และต้องมีอย่างน้อยหนึ่งรายการ';
    }
  }
  return 'บันทึกใบสั่งซื้อไม่สำเร็จ โปรดลองอีกครั้ง';
}

/** The message for a failed approve, reject, cancel or submit. */
function actionErrorMessage(error: unknown): string {
  if (error instanceof ORPCError && error.code === 'BAD_REQUEST') {
    return 'ต้องระบุเหตุผล';
  }
  return errorMessage(error);
}

/** Purchasing screen: draft, edit, submit, approve, reject and cancel purchase orders. */
export function PurchaseOrdersPage() {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const canWrite = user?.role === 'PURCHASING';
  const isManager = user?.role === 'MANAGER';
  const canReadAuditLog = isManager || user?.role === 'ADMIN';

  const orders = useQuery(
    orpc.purchaseOrders.list.queryOptions({ input: { page: 1, pageSize: 20 } }),
  );
  const suppliers = useQuery(
    orpc.suppliers.list.queryOptions({ input: { page: 1, pageSize: 100 } }),
  );
  const stores = useQuery(orpc.stores.list.queryOptions({ input: { page: 1, pageSize: 100 } }));
  // Inactive products are listed too, marked as such: the API is what refuses them (MD-02).
  const products = useQuery(
    orpc.products.list.queryOptions({ input: { page: 1, pageSize: 100, status: 'all' } }),
  );

  const auditLog = useQuery(
    orpc.auditLog.list.queryOptions({ input: { page: 1, pageSize: 20 }, enabled: canReadAuditLog }),
  );

  const refreshList = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.purchaseOrders.list.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.auditLog.key() });
  };

  // The reason a manager or creator typed for each order, by order id.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // The last submit, approve, reject or cancel that failed; cleared when the next one succeeds.
  const [actionError, setActionError] = useState<unknown>(null);
  const actionOptions = {
    onSuccess: () => {
      setActionError(null);
      refreshList();
    },
    onError: (error: unknown) => setActionError(error),
  };

  // The draft being edited, or null while writing a new one.
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [expectedReceiptDate, setExpectedReceiptDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const resetForm = () => {
    setEditing(null);
    setSupplierId('');
    setStoreId('');
    setExpectedReceiptDate('');
    setLines([emptyLine()]);
  };

  const create = useMutation(
    orpc.purchaseOrders.create.mutationOptions({
      onSuccess: () => {
        resetForm();
        refreshList();
      },
    }),
  );
  const update = useMutation(
    orpc.purchaseOrders.update.mutationOptions({
      onSuccess: () => {
        resetForm();
        refreshList();
      },
    }),
  );
  const submitOrder = useMutation(orpc.purchaseOrders.submit.mutationOptions(actionOptions));
  const approveOrder = useMutation(orpc.purchaseOrders.approve.mutationOptions(actionOptions));
  const rejectOrder = useMutation(orpc.purchaseOrders.reject.mutationOptions(actionOptions));
  const cancelOrder = useMutation(orpc.purchaseOrders.cancel.mutationOptions(actionOptions));
  const acting =
    submitOrder.isPending ||
    approveOrder.isPending ||
    rejectOrder.isPending ||
    cancelOrder.isPending;

  const startEditing = (order: PurchaseOrder) => {
    create.reset();
    update.reset();
    setEditing(order);
    setSupplierId(order.supplierId);
    setStoreId(order.storeId);
    setExpectedReceiptDate(order.expectedReceiptDate);
    setLines(
      order.lines.map((line) => ({
        productId: line.productId,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
      })),
    );
  };

  const changeLine = (index: number, change: Partial<LineDraft>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));

  const save = (event: FormEvent) => {
    event.preventDefault();
    // No min/step limits on the inputs: the contract is the one place that rejects bad numbers.
    const contents = {
      supplierId,
      storeId,
      expectedReceiptDate,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
      })),
    };
    if (editing) update.mutate({ id: editing.id, ...contents });
    else create.mutate(contents);
  };

  // Only a Draft or Pending Approval order can be cancelled, by its creator or a manager (PO-04).
  // The API makes the same checks; this only decides whether to show the button.
  const canCancel = (order: PurchaseOrder) =>
    (order.status === 'DRAFT' || order.status === 'PENDING_APPROVAL') &&
    (isManager || (user?.role === 'PURCHASING' && order.createdById === user.id));

  const saveError = editing ? update.error : create.error;
  const saving = create.isPending || update.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">ใบสั่งซื้อ</h1>
        <p className="text-muted-foreground">
          สร้างใบสั่งซื้อฉบับร่าง แก้ไข และส่งอนุมัติ การสร้างหรือส่งอนุมัติไม่ทำให้สต็อกเปลี่ยน
        </p>
      </div>

      {canWrite && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>{editing ? `แก้ไข ${editing.number}` : 'สร้างใบสั่งซื้อ'}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={save}>
              <div className="space-y-2">
                <Label htmlFor="supplier">ผู้จัดจำหน่าย</Label>
                <select
                  id="supplier"
                  required
                  className={selectClass}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="">เลือกผู้จัดจำหน่าย</option>
                  {suppliers.data?.items.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.code} {supplier.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="store">สาขาปลายทาง</Label>
                <select
                  id="store"
                  required
                  className={selectClass}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                >
                  <option value="">เลือกสาขาปลายทาง</option>
                  {stores.data?.items.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.code} {store.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedReceiptDate">วันที่คาดว่าจะได้รับ</Label>
                <Input
                  id="expectedReceiptDate"
                  type="date"
                  required
                  value={expectedReceiptDate}
                  onChange={(e) => setExpectedReceiptDate(e.target.value)}
                />
              </div>

              <fieldset className="space-y-4">
                <legend className="text-sm font-medium">รายการสินค้า</legend>
                {lines.map((line, index) => {
                  const n = index + 1;
                  return (
                    <div key={index} className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor={`product-${n}`}>สินค้า รายการที่ {n}</Label>
                        <select
                          id={`product-${n}`}
                          required
                          className={selectClass}
                          value={line.productId}
                          onChange={(e) => changeLine(index, { productId: e.target.value })}
                        >
                          <option value="">เลือกสินค้า</option>
                          {products.data?.items.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.sku} {product.name}
                              {product.active ? '' : ' (ปิดใช้งาน)'}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`quantity-${n}`}>จำนวน รายการที่ {n}</Label>
                        <Input
                          id={`quantity-${n}`}
                          type="number"
                          step="any"
                          required
                          value={line.quantity}
                          onChange={(e) => changeLine(index, { quantity: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`unitPrice-${n}`}>ราคาต่อหน่วย รายการที่ {n}</Label>
                        <Input
                          id={`unitPrice-${n}`}
                          type="number"
                          step="any"
                          required
                          value={line.unitPrice}
                          onChange={(e) => changeLine(index, { unitPrice: e.target.value })}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`ลบรายการที่ ${n}`}
                        disabled={lines.length === 1}
                        onClick={() => setLines(lines.filter((_, i) => i !== index))}
                      >
                        ลบ
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines([...lines, emptyLine()])}
                >
                  เพิ่มรายการสินค้า
                </Button>
              </fieldset>

              {saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {errorMessage(saveError)}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : 'บันทึกฉบับร่าง'}
                </Button>
                {editing && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    ยกเลิก
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>รายการใบสั่งซื้อ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionError !== null && (
            <p role="alert" className="text-sm text-destructive">
              {actionErrorMessage(actionError)}
            </p>
          )}

          {orders.isPending ? (
            <p className="text-muted-foreground">กำลังโหลด…</p>
          ) : orders.isError ? (
            <p role="alert" className="text-destructive">
              โหลดรายการไม่สำเร็จ โปรดลองอีกครั้ง
            </p>
          ) : orders.data.items.length === 0 ? (
            <p className="text-muted-foreground">ยังไม่มีใบสั่งซื้อ</p>
          ) : (
            <ul aria-label="รายการใบสั่งซื้อ" className="divide-y">
              {orders.data.items.map((order) => (
                <li key={order.id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-3">
                      <span className="font-medium">{order.number}</span>
                      <Badge variant={order.status === 'DRAFT' ? 'outline' : 'secondary'}>
                        {STATUS_LABEL[order.status]}
                      </Badge>
                      <span className="text-muted-foreground">
                        {order.supplierCode} → {order.storeCode} · รับวันที่{' '}
                        {order.expectedReceiptDate}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">รวม {money(order.totalAmount)}</span>
                      {canWrite && order.status === 'DRAFT' && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`แก้ไข ${order.number}`}
                            onClick={() => startEditing(order)}
                          >
                            แก้ไข
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`ส่งอนุมัติ ${order.number}`}
                            disabled={acting}
                            onClick={() => submitOrder.mutate({ id: order.id })}
                          >
                            ส่งอนุมัติ
                          </Button>
                        </>
                      )}
                      {isManager && order.status === 'PENDING_APPROVAL' && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            aria-label={`อนุมัติ ${order.number}`}
                            disabled={acting}
                            onClick={() => approveOrder.mutate({ id: order.id })}
                          >
                            อนุมัติ
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`ไม่อนุมัติ ${order.number}`}
                            disabled={acting}
                            onClick={() =>
                              rejectOrder.mutate({ id: order.id, reason: reasons[order.id] ?? '' })
                            }
                          >
                            ไม่อนุมัติ
                          </Button>
                        </>
                      )}
                      {canCancel(order) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`ยกเลิกใบสั่งซื้อ ${order.number}`}
                          disabled={acting}
                          onClick={() =>
                            cancelOrder.mutate({ id: order.id, reason: reasons[order.id] ?? '' })
                          }
                        >
                          ยกเลิกใบสั่งซื้อ
                        </Button>
                      )}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {order.lines.map((line) => (
                      <p key={line.id}>
                        {line.sku} {line.productName} · {line.quantity} {line.unit} ×{' '}
                        {money(line.unitPrice)} = {money(line.lineAmount)}
                      </p>
                    ))}
                  </div>
                  {order.decidedAt !== null && (
                    <p className="text-sm text-muted-foreground">
                      {DECIDED_BY_LABEL[order.status]} {order.decidedByName}
                      {order.decisionReason ? ` · เหตุผล: ${order.decisionReason}` : ''}
                    </p>
                  )}
                  {(canCancel(order) || (isManager && order.status === 'PENDING_APPROVAL')) && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`reason-${order.id}`}>เหตุผล {order.number}</Label>
                      <Input
                        id={`reason-${order.id}`}
                        className="max-w-sm"
                        value={reasons[order.id] ?? ''}
                        onChange={(e) => setReasons({ ...reasons, [order.id]: e.target.value })}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canReadAuditLog && (
        <Card>
          <CardHeader>
            <CardTitle>บันทึกการตรวจสอบ</CardTitle>
          </CardHeader>
          <CardContent>
            {auditLog.isPending ? (
              <p className="text-muted-foreground">กำลังโหลด…</p>
            ) : auditLog.isError ? (
              <p role="alert" className="text-destructive">
                โหลดบันทึกการตรวจสอบไม่สำเร็จ โปรดลองอีกครั้ง
              </p>
            ) : auditLog.data.items.length === 0 ? (
              <p className="text-muted-foreground">ยังไม่มีบันทึก</p>
            ) : (
              <ul aria-label="บันทึกการตรวจสอบ" className="divide-y">
                {auditLog.data.items.map((entry) => (
                  <li key={entry.id} className="py-2 text-sm">
                    <span className="font-medium">{entry.sourceDocumentNumber}</span>{' '}
                    {OUTCOME_LABEL[entry.outcome]} โดย {entry.actorName} ·{' '}
                    {new Date(entry.createdAt).toLocaleString('th-TH')}
                    {entry.reason ? ` · เหตุผล: ${entry.reason}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
