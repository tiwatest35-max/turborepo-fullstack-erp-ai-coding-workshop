import { oc } from '@orpc/contract';
import * as z from 'zod';
import {
  ApiErrorSchema,
  IdempotencyKeySchema,
  PaginationInputSchema,
  paginated,
} from './conventions.js';
import { PurchaseOrderStatusSchema } from './purchase-order.js';

/** One line the store employee confirms: how many units of a purchase order line arrived (GR-02). */
export const GoodsReceiptLineInputSchema = z.object({
  purchaseOrderLineId: z.string().min(1),
  /** A non-negative whole number. Zero means nothing of this line arrived in this delivery. */
  quantity: z.int().min(0),
});
export type GoodsReceiptLineInput = z.infer<typeof GoodsReceiptLineInputSchema>;

/**
 * What a store employee sends to confirm a delivery (GR-02). There is deliberately no date: the
 * system confirmation time is authoritative (Q-03). The order's own lines are the only products
 * that can be received, and each line may appear once.
 */
export const ConfirmGoodsReceiptInputSchema = z
  .object({
    purchaseOrderId: z.string().min(1),
    idempotencyKey: IdempotencyKeySchema,
    lines: z
      .array(GoodsReceiptLineInputSchema)
      .min(1)
      .refine((lines) => lines.some((line) => line.quantity > 0), {
        message: 'At least one line must have a quantity above zero',
      })
      .refine(
        (lines) => new Set(lines.map((line) => line.purchaseOrderLineId)).size === lines.length,
        { message: 'A line can appear only once in a receipt' },
      ),
  })
  .strict();
export type ConfirmGoodsReceiptInput = z.infer<typeof ConfirmGoodsReceiptInputSchema>;

/** A line of a confirmed receipt, as it was saved. */
export const GoodsReceiptLineSchema = z.object({
  id: z.string(),
  purchaseOrderLineId: z.string(),
  productId: z.string(),
  sku: z.string(),
  productName: z.string(),
  unit: z.string(),
  /** Whole units received in this delivery, always above zero. */
  quantity: z.int().min(1),
});
export type GoodsReceiptLine = z.infer<typeof GoodsReceiptLineSchema>;

/** A confirmed goods receipt (GR-03). It is read-only: nothing edits or cancels one (GR-05). */
export const GoodsReceiptSchema = z.object({
  id: z.string(),
  /** The unique document number, e.g. `GR-000001`. */
  number: z.string(),
  purchaseOrderId: z.string(),
  purchaseOrderNumber: z.string(),
  storeId: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  receivedById: z.string(),
  receivedByName: z.string(),
  /** The system confirmation time. */
  receivedAt: z.iso.datetime(),
  lines: z.array(GoodsReceiptLineSchema),
});
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;

/** A purchase order line on the receiving screen: ordered, previously received, outstanding (GR-01). */
export const ReceivableLineSchema = z.object({
  /** The purchase order line id, to send back in `confirm`. */
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  productName: z.string(),
  unit: z.string(),
  ordered: z.int().min(1),
  received: z.int().min(0),
  /** `ordered` minus `received`. */
  outstanding: z.int().min(0),
});
export type ReceivableLine = z.infer<typeof ReceivableLineSchema>;

/** An Approved or Partially Received order that can be received in the employee's store (GR-01). */
export const ReceivableOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: PurchaseOrderStatusSchema,
  supplierCode: z.string(),
  supplierName: z.string(),
  storeId: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  expectedReceiptDate: z.iso.date(),
  lines: z.array(ReceivableLineSchema),
});
export type ReceivableOrder = z.infer<typeof ReceivableOrderSchema>;

export const ListGoodsReceiptsInputSchema = PaginationInputSchema.extend({
  purchaseOrderId: z.string().min(1).optional(),
  /** Only this store. A store employee can only ask for their own. */
  storeId: z.string().min(1).optional(),
});
export type ListGoodsReceiptsInput = z.infer<typeof ListGoodsReceiptsInputSchema>;

export const goodsReceiptContract = {
  receivable: oc
    .route({
      method: 'GET',
      path: '/receiving/orders',
      summary: "List the Approved and Partially Received orders for the employee's store",
      tags: ['Goods receipts'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(PaginationInputSchema)
    .output(paginated(ReceivableOrderSchema)),
  confirm: oc
    .route({
      method: 'POST',
      path: '/goods-receipts',
      summary:
        'Confirm a goods receipt against an order (store employee). Repeating the same idempotencyKey returns the first receipt',
      tags: ['Goods receipts'],
    })
    .errors({
      NOT_FOUND: { data: ApiErrorSchema },
      FORBIDDEN: { data: ApiErrorSchema },
      CONFLICT: { data: ApiErrorSchema },
      BAD_REQUEST: { data: ApiErrorSchema },
    })
    .input(ConfirmGoodsReceiptInputSchema)
    .output(GoodsReceiptSchema),
  // Read-only on purpose: confirmed receipts cannot be edited or cancelled (GR-05).
  list: oc
    .route({
      method: 'GET',
      path: '/goods-receipts',
      summary: 'List goods receipts, newest first',
      tags: ['Goods receipts'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(ListGoodsReceiptsInputSchema)
    .output(paginated(GoodsReceiptSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/goods-receipts/{id}',
      summary: 'Get one goods receipt',
      tags: ['Goods receipts'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema }, FORBIDDEN: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(GoodsReceiptSchema),
};
