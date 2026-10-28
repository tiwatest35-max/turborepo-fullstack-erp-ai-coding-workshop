import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { SalesController } from './sales.controller.js';

/** Recording and confirming sales, which decrease stock (SAL-01 to SAL-04). */
@Module({
  imports: [StockModule],
  controllers: [SalesController],
})
export class SalesModule {}
