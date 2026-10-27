import { Module } from '@nestjs/common';
import { DocumentNumberingService } from './document-numbering.service.js';
import { StockController } from './stock.controller.js';
import { StockLedgerService } from './stock-ledger.service.js';

/** Stock balances, the append-only movement ledger, and document numbering. */
@Module({
  controllers: [StockController],
  providers: [StockLedgerService, DocumentNumberingService],
  // Later modules (goods receipts, sales, adjustments) post stock and number documents through these.
  exports: [StockLedgerService, DocumentNumberingService],
})
export class StockModule {}
