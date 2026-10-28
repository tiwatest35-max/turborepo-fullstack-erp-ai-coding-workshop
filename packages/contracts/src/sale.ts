import { oc } from '@orpc/contract';
import * as z from 'zod';
import {
  ApiErrorSchema,
  IdempotencyKeySchema,
  PaginationInputSchema,
  paginated,
} from './conventions.js';
import { PriceSchema } from './product.js';

/**
 * One line the store employee sells: how many units of a product (SAL-01). There is deliberately
 * no price: the product's current selling price is applied and frozen on confirmation, and a
 * caller cannot override it.
 */
export const SaleLineInputSchema = z
  .object({
    productId: z.string().min(1),
    /** A positive whole number. */
    quantity: z.int().min(1),
  })
  .strict();
export type SaleLineInput = z.infer<typeof SaleLineInputSchema>;

/**
 * What a store employee sends to confirm a sale (SAL-01 to SAL-03). The store is the employee's
 * assigned store and the time is the system confirmation time, so neither is in the input. Each
 * product may appear once.
 */
export const ConfirmSaleInputSchema = z
  .object({
    idempotencyKey: IdempotencyKeySchema,
    lines: z
      .array(SaleLineInputSchema)
      .min(1)
      .refine((lines) => new Set(lines.map((line) => line.productId)).size === lines.length, {
        message: 'A product can appear only once in a sale',
      }),
  })
  .strict();
export type ConfirmSaleInput = z.infer<typeof ConfirmSaleInputSchema>;

/** A line of a confirmed sale, as it was saved. */
export const SaleLineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  productName: z.string(),
  unit: z.string(),
  /** Whole units sold, always above zero. */
  quantity: z.int().min(1),
  /** The selling price per unit in THB at confirmation, frozen in the document. */
  unitPrice: PriceSchema,
  /** `quantity` times `unitPrice`, in THB. */
  lineTotal: PriceSchema,
});
export type SaleLine = z.infer<typeof SaleLineSchema>;

/** A confirmed sale (SAL-03). It is read-only: nothing edits, cancels or returns one (SAL-04). */
export const SaleSchema = z.object({
  id: z.string(),
  /** The unique document number, e.g. `SL-000001`. */
  number: z.string(),
  storeId: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  soldById: z.string(),
  soldByName: z.string(),
  /** The system confirmation time. */
  soldAt: z.iso.datetime(),
  lines: z.array(SaleLineSchema),
  /** The sum of the line totals, in THB. */
  total: PriceSchema,
});
export type Sale = z.infer<typeof SaleSchema>;

export const ListSalesInputSchema = PaginationInputSchema.extend({
  /** Only this store. A store employee can only ask for their own. */
  storeId: z.string().min(1).optional(),
});
export type ListSalesInput = z.infer<typeof ListSalesInputSchema>;

export const saleContract = {
  confirm: oc
    .route({
      method: 'POST',
      path: '/sales',
      summary:
        "Confirm a sale in the employee's store and decrease stock (store employee). Repeating the same idempotencyKey returns the first sale",
      tags: ['Sales'],
    })
    .errors({
      FORBIDDEN: { data: ApiErrorSchema },
      CONFLICT: { data: ApiErrorSchema },
      BAD_REQUEST: { data: ApiErrorSchema },
    })
    .input(ConfirmSaleInputSchema)
    .output(SaleSchema),
  // Read-only on purpose: confirmed sales cannot be edited, cancelled or returned (SAL-04).
  list: oc
    .route({
      method: 'GET',
      path: '/sales',
      summary: 'List sales, newest first',
      tags: ['Sales'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(ListSalesInputSchema)
    .output(paginated(SaleSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/sales/{id}',
      summary: 'Get one sale',
      tags: ['Sales'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema }, FORBIDDEN: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(SaleSchema),
};
