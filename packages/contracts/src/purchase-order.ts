import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiErrorSchema, PaginationInputSchema, paginated } from './conventions.js';
import { PriceSchema } from './product.js';

/**
 * Where a purchase order is (PO-02). Only the first two exist so far: approval, receiving,
 * rejection and cancellation add theirs with their own tickets.
 */
export const PurchaseOrderStatusSchema = z.enum(['DRAFT', 'PENDING_APPROVAL']);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatusSchema>;

/** One product line the client sends (PO-01): a whole, positive quantity and a price of 0 or more. */
export const PurchaseOrderLineInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.int().min(1),
  unitPrice: PriceSchema,
});
export type PurchaseOrderLineInput = z.infer<typeof PurchaseOrderLineInputSchema>;

/**
 * What a purchasing officer fills in to create a draft, or to replace a draft's contents
 * (PO-01, PO-03): one supplier, one destination store (MD-03), an expected receipt date, and
 * at least one line. A product may appear only once per order.
 */
export const PurchaseOrderInputSchema = z
  .object({
    supplierId: z.string().min(1),
    storeId: z.string().min(1),
    /** A calendar date, `YYYY-MM-DD`. */
    expectedReceiptDate: z.iso.date(),
    lines: z
      .array(PurchaseOrderLineInputSchema)
      .min(1)
      .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
        message: 'A product can appear only once in an order',
      }),
  })
  .strict();
export type PurchaseOrderInput = z.infer<typeof PurchaseOrderInputSchema>;

export const UpdatePurchaseOrderInputSchema = PurchaseOrderInputSchema.extend({
  id: z.string().min(1),
});
export type UpdatePurchaseOrderInput = z.infer<typeof UpdatePurchaseOrderInputSchema>;

/**
 * A line as the API shows it. `sku`, `productName`, `unit` and `unitPrice` are the values saved
 * with the line, so a later product edit does not change them (TOR 4.3).
 */
export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  productName: z.string(),
  unit: z.string(),
  quantity: z.int().min(1),
  unitPrice: PriceSchema,
  /** `quantity` times `unitPrice`, to two decimal places (TOR 4.3). */
  lineAmount: z.number().min(0),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  /** The unique document number, e.g. `PO-000001`. */
  number: z.string(),
  status: PurchaseOrderStatusSchema,
  supplierId: z.string(),
  supplierCode: z.string(),
  supplierName: z.string(),
  storeId: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  expectedReceiptDate: z.iso.date(),
  createdById: z.string(),
  createdByName: z.string(),
  createdAt: z.iso.datetime(),
  /** Null while the order is a draft. */
  submittedAt: z.iso.datetime().nullable(),
  lines: z.array(PurchaseOrderLineSchema),
  /** The sum of the line amounts, to two decimal places (TOR 4.3). */
  totalAmount: z.number().min(0),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const ListPurchaseOrdersInputSchema = PaginationInputSchema.extend({
  status: PurchaseOrderStatusSchema.optional(),
});
export type ListPurchaseOrdersInput = z.infer<typeof ListPurchaseOrdersInputSchema>;

/** The errors a write on a purchase order can answer with. */
const writeErrors = {
  NOT_FOUND: { data: ApiErrorSchema },
  CONFLICT: { data: ApiErrorSchema },
  BAD_REQUEST: { data: ApiErrorSchema },
};

export const purchaseOrderContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/purchase-orders',
      summary: 'List purchase orders, newest first',
      tags: ['Purchase orders'],
    })
    .input(ListPurchaseOrdersInputSchema)
    .output(paginated(PurchaseOrderSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/purchase-orders/{id}',
      summary: 'Get one purchase order',
      tags: ['Purchase orders'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(PurchaseOrderSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/purchase-orders',
      summary: 'Create a draft purchase order (purchasing officer)',
      tags: ['Purchase orders'],
    })
    .errors({ BAD_REQUEST: { data: ApiErrorSchema } })
    .input(PurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
  update: oc
    .route({
      method: 'PUT',
      path: '/purchase-orders/{id}',
      summary: 'Replace the contents of a draft purchase order (purchasing officer)',
      tags: ['Purchase orders'],
    })
    .errors(writeErrors)
    .input(UpdatePurchaseOrderInputSchema)
    .output(PurchaseOrderSchema),
  submit: oc
    .route({
      method: 'POST',
      path: '/purchase-orders/{id}/submit',
      summary: 'Submit a draft purchase order for approval (purchasing officer)',
      tags: ['Purchase orders'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema }, CONFLICT: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(PurchaseOrderSchema),
};
