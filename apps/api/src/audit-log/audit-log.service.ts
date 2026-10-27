import { Injectable } from '@nestjs/common';
import type { AuditOutcome } from '@erp/contracts';
import type { Prisma } from '@erp/database';

export type AuditEntry = {
  actorId: string;
  /** The kind of document acted on, e.g. `PURCHASE_ORDER`. */
  sourceDocumentType: string;
  sourceDocumentNumber: string;
  outcome: AuditOutcome;
  reason?: string;
};

/**
 * Writes the append-only audit log. `record` takes the caller's transaction, like
 * `StockLedgerService.post`: the entry commits or rolls back with the action it describes,
 * so a recorded action always happened and a successful one is always recorded.
 * An entry holds only the fields above, never a password, token or other secret.
 */
@Injectable()
export class AuditLogService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        sourceDocumentType: entry.sourceDocumentType,
        sourceDocumentNumber: entry.sourceDocumentNumber,
        outcome: entry.outcome,
        reason: entry.reason ?? null,
      },
    });
  }
}
