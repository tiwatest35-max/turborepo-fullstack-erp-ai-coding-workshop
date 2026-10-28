import { oc } from '@orpc/contract';
import * as z from 'zod';
import {
  ApiErrorSchema,
  CsvExportSchema,
  PaginationInputSchema,
  paginated,
} from './conventions.js';

/** Why stock went up or down (INV-02). `OPENING` is the balance a store started with. */
export const StockMovementTypeSchema = z.enum(['OPENING', 'RECEIPT', 'SALE', 'ADJUSTMENT']);
export type StockMovementType = z.infer<typeof StockMovementTypeSchema>;

/** The stock of one product in one store (INV-01). Whole units, never negative (INV-03). */
export const StockLevelSchema = z.object({
  productId: z.string(),
  sku: z.string(),
  productName: z.string(),
  unit: z.string(),
  storeId: z.string(),
  storeCode: z.string(),
  storeName: z.string(),
  quantity: z.int().min(0),
  /** Null when the product has no reorder threshold in this store. */
  reorderThreshold: z.int().min(0).nullable(),
  /** True when the quantity is at or below the threshold (INV-01). Always false without one. */
  lowStock: z.boolean(),
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const SearchStockInputSchema = PaginationInputSchema.extend({
  /** Matches SKU or product name, case-insensitive. */
  search: z.string().trim().min(1).optional(),
  /** Only this store. A store employee can only ask for their own. */
  storeId: z.string().min(1).optional(),
  /** The low-stock report (RPT-02): only rows at or below their reorder threshold. */
  // A GET query string carries "true"/"false", so accept those as well as a real boolean.
  lowStockOnly: z.union([z.boolean(), z.stringbool()]).optional(),
});
export type SearchStockInput = z.infer<typeof SearchStockInputSchema>;

/**
 * The stock and low-stock report export (RPT-04): the same filters as the screen, without
 * paging, so the file holds every matching row.
 */
export const ExportStockInputSchema = SearchStockInputSchema.omit({ page: true, pageSize: true });
export type ExportStockInput = z.infer<typeof ExportStockInputSchema>;

/** One line of the append-only stock ledger (INV-02). There is no way to change one. */
export const StockMovementSchema = z.object({
  id: z.string(),
  productId: z.string(),
  /** SKU and name as they were when the movement happened. */
  productSku: z.string(),
  productName: z.string(),
  storeId: z.string(),
  storeCode: z.string(),
  /** Positive for an increase, negative for a decrease. */
  quantityChange: z.int().refine((value) => value !== 0),
  balanceBefore: z.int().min(0),
  balanceAfter: z.int().min(0),
  movementType: StockMovementTypeSchema,
  /** The kind of document behind the movement, e.g. `OPENING_BALANCE`, `GOODS_RECEIPT`. */
  sourceDocumentType: z.string(),
  /** Null for an opening balance. */
  sourceDocumentNumber: z.string().nullable(),
  actorId: z.string(),
  actorName: z.string(),
  createdAt: z.iso.datetime(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

export const ListStockMovementsInputSchema = PaginationInputSchema.extend({
  productId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
});
export type ListStockMovementsInput = z.infer<typeof ListStockMovementsInputSchema>;

/**
 * A manager's stock adjustment (INV-05): increase or decrease the stock of one product in one
 * store, with a mandatory reason. `quantityChange` is a non-zero whole number (positive to
 * increase, negative to decrease). The reason is recorded in the audit log.
 */
export const AdjustStockInputSchema = z
  .object({
    productId: z.string().min(1),
    storeId: z.string().min(1),
    quantityChange: z.int().refine((value) => value !== 0, { message: 'A change cannot be zero' }),
    reason: z.string().trim().min(1),
  })
  .strict();
export type AdjustStockInput = z.infer<typeof AdjustStockInputSchema>;

export const stockContract = {
  search: oc
    .route({
      method: 'GET',
      path: '/stock',
      summary: 'Search stock by SKU, product name and store',
      tags: ['Stock'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(SearchStockInputSchema)
    .output(paginated(StockLevelSchema)),
  exportCsv: oc
    .route({
      method: 'GET',
      path: '/stock/export',
      summary: 'Export the stock or low-stock report as CSV, with the same filters (RPT-04)',
      tags: ['Stock'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(ExportStockInputSchema)
    .output(CsvExportSchema),
  // Read-only on purpose: confirmed movements cannot be edited or deleted (INV-02).
  movements: oc
    .route({
      method: 'GET',
      path: '/stock/movements',
      summary: 'List stock movements, newest first',
      tags: ['Stock'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(ListStockMovementsInputSchema)
    .output(paginated(StockMovementSchema)),
  adjust: oc
    .route({
      method: 'POST',
      path: '/stock/adjustments',
      summary: 'Adjust the stock of a product with a mandatory reason (manager only)',
      tags: ['Stock'],
    })
    .errors({ CONFLICT: { data: ApiErrorSchema }, BAD_REQUEST: { data: ApiErrorSchema } })
    .input(AdjustStockInputSchema)
    .output(StockMovementSchema),
};
