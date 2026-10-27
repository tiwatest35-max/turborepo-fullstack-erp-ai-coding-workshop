import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiErrorSchema, PaginationInputSchema, paginated } from './conventions.js';

/** A supplier as the API exposes it (MD-03: code, name, and contact details). */
export const SupplierSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  name: z.string().min(1),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.email().nullable(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

/** Create payload: the client supplies everything except the server-assigned id. */
export const CreateSupplierInputSchema = SupplierSchema.omit({ id: true }).strict();
export type CreateSupplierInput = z.infer<typeof CreateSupplierInputSchema>;

/** Update payload: the id plus any editable fields. Code is editable; id is not. */
export const UpdateSupplierInputSchema = SupplierSchema.omit({ id: true })
  .partial()
  .extend({ id: z.string().min(1) });
export type UpdateSupplierInput = z.infer<typeof UpdateSupplierInputSchema>;

export const supplierContract = {
  list: oc
    .route({ method: 'GET', path: '/suppliers', summary: 'List suppliers', tags: ['Suppliers'] })
    .input(PaginationInputSchema)
    .output(paginated(SupplierSchema)),
  get: oc
    .route({
      method: 'GET',
      path: '/suppliers/{id}',
      summary: 'Get one supplier',
      tags: ['Suppliers'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(SupplierSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/suppliers',
      summary: 'Create a supplier (admin only)',
      tags: ['Suppliers'],
    })
    .errors({ CONFLICT: { data: ApiErrorSchema } })
    .input(CreateSupplierInputSchema)
    .output(SupplierSchema),
  update: oc
    .route({
      method: 'PATCH',
      path: '/suppliers/{id}',
      summary: 'Update a supplier (admin only)',
      tags: ['Suppliers'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema }, CONFLICT: { data: ApiErrorSchema } })
    .input(UpdateSupplierInputSchema)
    .output(SupplierSchema),
};
