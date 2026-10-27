import { oc } from '@orpc/contract';
import * as z from 'zod';
import { PaginationInputSchema, paginated } from './conventions.js';

/**
 * A reference route that exercises the shared conventions end-to-end. It paginates
 * a fixed in-memory list so the pagination envelope and the standard error shape
 * can be demonstrated and tested before any real feature consumes them. Feature
 * contracts (suppliers, stores, products, ...) follow this same shape.
 */
export const ExampleItemSchema = z.object({
  id: z.string(),
  label: z.string(),
});
export type ExampleItem = z.infer<typeof ExampleItemSchema>;

export const conventionsContract = {
  list: oc
    .route({
      method: 'GET',
      path: '/conventions/example',
      summary: 'Reference list route demonstrating the pagination envelope',
      tags: ['Conventions'],
    })
    .input(PaginationInputSchema)
    .output(paginated(ExampleItemSchema)),
};
