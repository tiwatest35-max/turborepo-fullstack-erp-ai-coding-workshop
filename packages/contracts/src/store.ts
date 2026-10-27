import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiErrorSchema, PaginationInputSchema, paginated } from './conventions.js';

/** A store as the API exposes it (MD-03: code and name). Stores double as stock locations. */
export const StoreSchema = z.object({
  id: z.string(),
  code: z.string().min(1),
  name: z.string().min(1),
});
export type Store = z.infer<typeof StoreSchema>;

/** Create payload: the client supplies everything except the server-assigned id. */
export const CreateStoreInputSchema = StoreSchema.omit({ id: true }).strict();
export type CreateStoreInput = z.infer<typeof CreateStoreInputSchema>;

/** Update payload: the id plus any editable fields. Code is editable; id is not. */
export const UpdateStoreInputSchema = StoreSchema.omit({ id: true })
  .partial()
  .extend({ id: z.string().min(1) });
export type UpdateStoreInput = z.infer<typeof UpdateStoreInputSchema>;

export const storeContract = {
  list: oc
    .route({ method: 'GET', path: '/stores', summary: 'List stores', tags: ['Stores'] })
    .input(PaginationInputSchema)
    .output(paginated(StoreSchema)),
  get: oc
    .route({ method: 'GET', path: '/stores/{id}', summary: 'Get one store', tags: ['Stores'] })
    .errors({ NOT_FOUND: { data: ApiErrorSchema } })
    .input(z.object({ id: z.string().min(1) }))
    .output(StoreSchema),
  create: oc
    .route({
      method: 'POST',
      path: '/stores',
      summary: 'Create a store (admin only)',
      tags: ['Stores'],
    })
    .errors({ CONFLICT: { data: ApiErrorSchema } })
    .input(CreateStoreInputSchema)
    .output(StoreSchema),
  update: oc
    .route({
      method: 'PATCH',
      path: '/stores/{id}',
      summary: 'Update a store (admin only)',
      tags: ['Stores'],
    })
    .errors({ NOT_FOUND: { data: ApiErrorSchema }, CONFLICT: { data: ApiErrorSchema } })
    .input(UpdateStoreInputSchema)
    .output(StoreSchema),
};
