import { auditLogContract } from './audit-log.js';
import { authContract } from './auth.js';
import { conventionsContract } from './conventions-route.js';
import { healthContract } from './health.js';
import { productContract } from './product.js';
import { purchaseOrderContract } from './purchase-order.js';
import { stockContract } from './stock.js';
import { storeContract } from './store.js';
import { supplierContract } from './supplier.js';

export * from './audit-log.js';
export * from './auth.js';
export * from './conventions.js';
export * from './conventions-route.js';
export * from './health.js';
export * from './product.js';
export * from './purchase-order.js';
export * from './stock.js';
export * from './store.js';
export * from './supplier.js';

/**
 * The single source of truth for the HTTP API.
 * - apps/api implements it (see `@Implement(...)` in the Nest controllers)
 * - apps/web calls it through a fully typed client (see `src/lib/orpc.ts`)
 *
 * Add new feature contracts here, e.g. `customers: customersContract`.
 */
export const contract = {
  auditLog: auditLogContract,
  auth: authContract,
  conventions: conventionsContract,
  health: healthContract,
  products: productContract,
  purchaseOrders: purchaseOrderContract,
  stock: stockContract,
  stores: storeContract,
  suppliers: supplierContract,
};

export type Contract = typeof contract;
