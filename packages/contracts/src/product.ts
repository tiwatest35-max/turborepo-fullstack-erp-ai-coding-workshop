import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiErrorSchema, PaginationInputSchema, paginated } from './conventions.js';

/** A price in THB: never negative (MD-02), at most two decimal places. */
export const PriceSchema = z
  .number()
  .min(0)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'Price must have at most two decimal places',
  });

/** A reorder threshold for one store: a whole number, never negative (MD-02). */
export const ReorderThresholdSchema = z.object({
  storeId: z.string().min(1),
  threshold: z.int().min(0),
});
export type ReorderThreshold = z.infer<typeof ReorderThresholdSchema>;

const ReorderThresholdsSchema = z
  .array(ReorderThresholdSchema)
  .refine((rows) => new Set(rows.map((row) => row.storeId)).size === rows.length, {
    message: 'Only one reorder threshold per store',
  });

/** A product as the API exposes it (MD-01). */
export const ProductSchema = z.object({
  id: z.string(),
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  sellingPrice: PriceSchema,
  active: z.boolean(),
  /** One entry per store that has a threshold; stores without an entry have none. */
  reorderThresholds: ReorderThresholdsSchema,
});
export type Product = z.infer<typeof ProductSchema>;

/** Create payload: everything except the server-assigned id. New products start active. */
export const CreateProductInputSchema = ProductSchema.omit({ id: true })
  .extend({
    active: z.boolean().default(true),
    reorderThresholds: ReorderThresholdsSchema.default([]),
  })
  .strict();
export type CreateProductInput = z.input<typeof CreateProductInputSchema>;

/**
 * Update payload: the id plus any editable fields. When `reorderThresholds` is
 * sent it replaces the product's whole set of thresholds.
 */
export const UpdateProductInputSchema = ProductSchema.omit({ id: true })
  .partial()
  .extend({ id: z.string().min(1) });
export type UpdateProductInput = z.infer<typeof UpdateProductInputSchema>;

/** `all` is the default so a deactivated product stays findable (MD-02). */
export const ProductStatusFilterSchema = z.enum(['all', 'active', 'inactive']);

export const ListProductsInputSchema = PaginationInputSchema.extend({
  /** Matches SKU or name, case-insensitive. */
  search: z.string().trim().min(1).optional(),
  status: ProductStatusFilterSchema.default('all'),
});
export type ListProductsInput = z.infer<typeof ListProductsInputSchema>;

export const productContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/products',
      summary: 'List and search products',
      tags: ['Products'],
    })
    .input(ListProductsInputSchema)
    .output(paginated(ProductSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/products/{id}',
      summary: 'Get one product',
      tags: ['Products'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(ProductSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/products',
      summary: 'Create a product (admin only)',
      tags: ['Products'],
    })
    .errors({ CONFLICT: { data: ApiErrorSchema }, BAD_REQUEST: { data: ApiErrorSchema } })
    .input(CreateProductInputSchema)
    .output(ProductSchema),
  update: oc
    .route({
      method: 'PATCH',
      path: '/products/{id}',
      summary: 'Update or deactivate a product (admin only)',
      tags: ['Products'],
    })
    .errors({
      NOT_FOUND: { data: ApiErrorSchema },
      CONFLICT: { data: ApiErrorSchema },
      BAD_REQUEST: { data: ApiErrorSchema },
    })
    .input(UpdateProductInputSchema)
    .output(ProductSchema),
};
