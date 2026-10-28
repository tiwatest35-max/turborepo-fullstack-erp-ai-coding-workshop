import { Controller } from '@nestjs/common';
import { apiError, contract, type Sale, type User } from '@erp/contracts';
import { Prisma } from '@erp/database';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';
import { InsufficientStockError, StockLedgerService } from '../stock/stock-ledger.service.js';

/** Sales are numbered SL-000001, SL-000002, ... (TOR 4.3). */
const NUMBER_PREFIX = 'SL';

/** What the stock movements call a sale. */
const MOVEMENT_DOCUMENT_TYPE = 'SALE';

/** What the queries load so a row can be exposed as a `Sale`. */
const WITH_DETAILS = {
  store: { select: { code: true, name: true } },
  soldBy: { select: { name: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.SaleInclude;

type SaleRow = Prisma.SaleGetPayload<{ include: typeof WITH_DETAILS }>;

/** THB amounts are computed in whole satang, so adding them never picks up float noise. */
const toSatang = (price: { toString(): string }) => Math.round(Number(price.toString()) * 100);

/** Prisma row -> contract shape. */
function toSale(row: SaleRow): Sale {
  const lines = row.lines.map((line) => {
    const lineSatang = toSatang(line.unitPrice) * line.quantity;
    return {
      id: line.id,
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: toSatang(line.unitPrice) / 100,
      lineTotal: lineSatang / 100,
      lineSatang,
    };
  });
  return {
    id: row.id,
    number: row.number,
    storeId: row.storeId,
    storeCode: row.store.code,
    storeName: row.store.name,
    soldById: row.soldById,
    soldByName: row.soldBy.name,
    soldAt: row.soldAt.toISOString(),
    lines: lines.map(({ lineSatang: _lineSatang, ...line }) => line),
    total: lines.reduce((sum, line) => sum + line.lineSatang, 0) / 100,
  };
}

type Shortage = { sku: string; available: number; requested: number };

/** One message naming every product that is short, with what the store holds and what was asked (SAL-02). */
const insufficientStock = (shortages: Shortage[]) =>
  apiError(
    'SALE_INSUFFICIENT_STOCK',
    `สต็อกไม่พอสำหรับ ${shortages
      .map((s) => `${s.sku} (มี ${s.available} ต้องการ ${s.requested})`)
      .join(', ')} ไม่ได้บันทึกการขาย โปรดลดจำนวนแล้วลองอีกครั้ง`,
    'correct_input',
  );

@Controller()
export class SalesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly ledger: StockLedgerService,
  ) {}

  @Roles('STORE_EMPLOYEE')
  @Implement(contract.sales.confirm)
  confirm(@CurrentUser() user: User) {
    return implement(contract.sales.confirm).handler(({ input, errors }) =>
      this.prisma.$transaction(async (tx) => {
        const storeId = user.storeId!;
        const products = await tx.product.findMany({
          where: { id: { in: input.lines.map((line) => line.productId) } },
        });
        const byId = new Map(products.map((product) => [product.id, product]));

        // Validate the latest balance of every line before changing anything, so one message can
        // name every short product (SAL-02). The ledger's guarded update below is what holds
        // under concurrency: a balance can never go below zero, however two sales interleave.
        const balances = await tx.stockBalance.findMany({
          where: { storeId, productId: { in: [...byId.keys()] } },
        });
        const onHand = new Map(balances.map((b) => [b.productId, b.quantity]));
        const shortages = input.lines
          .map((line) => ({
            sku: byId.get(line.productId)!.sku,
            available: onHand.get(line.productId) ?? 0,
            requested: line.quantity,
          }))
          .filter((s) => s.requested > s.available);
        if (shortages.length > 0) throw errors.CONFLICT({ data: insufficientStock(shortages) });

        const number = await this.numbering.next(tx, NUMBER_PREFIX);
        const sale = await tx.sale.create({
          data: {
            number,
            storeId,
            soldById: user.id,
            lines: {
              create: input.lines.map((line) => {
                const product = byId.get(line.productId)!;
                return {
                  productId: product.id,
                  sku: product.sku,
                  productName: product.name,
                  unit: product.unit,
                  quantity: line.quantity,
                  unitPrice: product.sellingPrice,
                };
              }),
            },
          },
          include: WITH_DETAILS,
        });

        // Always lock balances in the same order, so two sales with the same products listed in a
        // different order wait for each other instead of deadlocking.
        const inLockOrder = [...input.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1));
        for (const line of inLockOrder) {
          try {
            await this.ledger.post(tx, {
              productId: line.productId,
              storeId,
              quantityChange: -line.quantity,
              movementType: 'SALE',
              sourceDocumentType: MOVEMENT_DOCUMENT_TYPE,
              sourceDocumentNumber: number,
              actorId: user.id,
            });
          } catch (error) {
            // Another sale took the stock after the check above. Throwing rolls everything back.
            if (error instanceof InsufficientStockError) {
              const shortage = {
                sku: byId.get(line.productId)!.sku,
                available: error.available,
                requested: error.requested,
              };
              throw errors.CONFLICT({ data: insufficientStock([shortage]) });
            }
            throw error;
          }
        }
        return toSale(sale);
      }),
    );
  }
}
