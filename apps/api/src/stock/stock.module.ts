import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import { StockController } from './stock.controller.js';
import { StockLedgerService } from './stock-ledger.service.js';

/** Stock balances, the append-only movement ledger, and document numbering. */
@Module({
  // The manager adjustment writes an audit entry (INV-05).
  imports: [AuditLogModule],
  controllers: [StockController],
  providers: [StockLedgerService, DocumentNumberingService],
  // Later modules (goods receipts, sales, adjustments) post stock and number documents through these.
  exports: [StockLedgerService, DocumentNumberingService],
})
export class StockModule {}
