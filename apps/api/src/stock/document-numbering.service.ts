import { Injectable } from '@nestjs/common';
import type { Prisma } from '@erp/database';

/** Two to four capital letters, e.g. `PO` (purchase order), `GR` (goods receipt), `SL` (sale). */
const PREFIX = /^[A-Z]{2,4}$/;
const DIGITS = 6;

/**
 * Hands out the unique, human-readable numbers documents carry (TOR 4.3), e.g. `GR-000001`.
 *
 * `next` takes the caller's transaction, like `StockLedgerService.post`. The number is taken in
 * the same transaction as the document: if the document rolls back, so does the number, and a
 * second document that wants the same prefix waits until the first one commits.
 */
@Injectable()
export class DocumentNumberingService {
  async next(tx: Prisma.TransactionClient, prefix: string): Promise<string> {
    if (!PREFIX.test(prefix)) {
      throw new RangeError('A document prefix is two to four capital letters');
    }

    // One atomic statement creates the counter or bumps it, and locks its row until commit.
    const [row] = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "DocumentSequence" ("prefix", "lastValue")
      VALUES (${prefix}, 1)
      ON CONFLICT ("prefix") DO UPDATE SET "lastValue" = "DocumentSequence"."lastValue" + 1
      RETURNING "lastValue"`;

    return `${prefix}-${String(row!.lastValue).padStart(DIGITS, '0')}`;
  }
}
