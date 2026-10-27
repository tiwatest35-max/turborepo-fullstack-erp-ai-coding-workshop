import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

/** Confirming goods receipts against approved purchase orders (GR-01 to GR-05). */
@Module({
  imports: [StockModule],
  controllers: [GoodsReceiptsController],
})
export class GoodsReceiptsModule {}
