import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { StockModule } from '../stock/stock.module.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

/**
 * Draft, submit, approve, reject and cancel purchase orders (PO-01 to PO-04). Numbers come
 * from the stock module, and approvals and rejections are recorded by the audit log module.
 */
@Module({
  imports: [StockModule, AuditLogModule],
  controllers: [PurchaseOrdersController],
})
export class PurchaseOrdersModule {}
