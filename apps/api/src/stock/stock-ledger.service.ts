import { Injectable } from '@nestjs/common';
import type { Prisma, StockMovement, StockMovementType } from '@erp/database';

export type PostStockMovementInput = {
  productId: string;
  storeId: string;
  /** Positive to increase stock, negative to decrease it. A whole number, never zero. */
  quantityChange: number;
  movementType: StockMovementType;
  /** The kind of document behind the movement, e.g. `GOODS_RECEIPT` or `SALE`. */
  sourceDocumentType: string;
  /** Its number from `DocumentNumberingService`, when it has one. */
  sourceDocumentNumber?: string;
  actorId: string;
};

/** A decrease would take a balance below zero (INV-03, INV-05). Nothing was changed. */
export class InsufficientStockError extends Error {
  constructor(
    readonly productId: string,
    readonly storeId: string,
    readonly available: number,
    readonly requested: number,
  ) {
    super(`Insufficient stock: ${available} available, ${requested} requested`);
    this.name = 'InsufficientStockError';
  }
}

/**
 * The only writer of `StockBalance` and `StockMovement`.
 *
 * `post` takes the caller's transaction on purpose: a document (goods receipt, sale,
 * adjustment) and the stock it moves succeed together or roll back together (INV-03).
 */
@Injectable()
export class StockLedgerService {
  async post(tx: Prisma.TransactionClient, input: PostStockMovementInput): Promise<StockMovement> {
    const { productId, storeId, quantityChange } = input;
    if (!Number.isInteger(quantityChange) || quantityChange === 0) {
      throw new RangeError('A stock movement must be a non-zero whole number');
    }

    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { sku: true, name: true },
    });

    // First movement for this product in this store: start the balance at zero.
    await tx.$executeRaw`
      INSERT INTO "StockBalance" ("productId", "storeId", "quantity", "updatedAt")
      VALUES (${productId}, ${storeId}, 0, now())
      ON CONFLICT ("productId", "storeId") DO NOTHING`;

    // One statement checks and changes the balance. It locks the row until the transaction ends,
    // so a concurrent movement waits and then sees the new balance: no update is lost (INV-04),
    // and the guard in WHERE means a decrease can never take the balance below zero (INV-03).
    const updated = await tx.$queryRaw<{ quantity: number }[]>`
      UPDATE "StockBalance"
      SET "quantity" = "quantity" + ${quantityChange}, "updatedAt" = now()
      WHERE "productId" = ${productId} AND "storeId" = ${storeId}
        AND "quantity" + ${quantityChange} >= 0
      RETURNING "quantity"`;

    if (updated.length === 0) {
      const current = await tx.stockBalance.findUniqueOrThrow({
        where: { productId_storeId: { productId, storeId } },
      });
      throw new InsufficientStockError(productId, storeId, current.quantity, -quantityChange);
    }

    const balanceAfter = updated[0]!.quantity;
    return tx.stockMovement.create({
      data: {
        productId,
        productSku: product.sku,
        productName: product.name,
        storeId,
        quantityChange,
        balanceBefore: balanceAfter - quantityChange,
        balanceAfter,
        movementType: input.movementType,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentNumber: input.sourceDocumentNumber ?? null,
        actorId: input.actorId,
      },
    });
  }
}
