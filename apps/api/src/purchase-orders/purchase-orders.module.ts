import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

/** Draft and submit purchase orders (PO-01 to PO-03). Numbers come from the stock module. */
@Module({
  imports: [StockModule],
  controllers: [PurchaseOrdersController],
})
export class PurchaseOrdersModule {}
