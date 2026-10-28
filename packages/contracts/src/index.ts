import { auditLogContract } from './audit-log.js';
import { authContract } from './auth.js';
import { conventionsContract } from './conventions-route.js';
import { goodsReceiptContract } from './goods-receipt.js';
import { healthContract } from './health.js';
import { productContract } from './product.js';
import { purchaseOrderContract } from './purchase-order.js';
import { reportContract } from './report.js';
import { saleContract } from './sale.js';
import { stockContract } from './stock.js';
import { storeContract } from './store.js';
import { supplierContract } from './supplier.js';

export * from './audit-log.js';
export * from './auth.js';
export * from './conventions.js';
export * from './conventions-route.js';
export * from './goods-receipt.js';
export * from './health.js';
export * from './product.js';
export * from './purchase-order.js';
export * from './report.js';
export * from './sale.js';
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
  goodsReceipts: goodsReceiptContract,
  health: healthContract,
  products: productContract,
  purchaseOrders: purchaseOrderContract,
  reports: reportContract,
  sales: saleContract,
  stock: stockContract,
  stores: storeContract,
  suppliers: supplierContract,
};

export type Contract = typeof contract;
