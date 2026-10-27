import { Controller } from '@nestjs/common';
import { contract, type GoodsReceipt, type User } from '@erp/contracts';
import { Prisma } from '@erp/database';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';

/** Goods receipts are numbered GR-000001, GR-000002, ... (TOR 4.3). */
const NUMBER_PREFIX = 'GR';

/** What the stock movements call a goods receipt. */
const MOVEMENT_DOCUMENT_TYPE = 'GOODS_RECEIPT';

/** What the queries load so a row can be exposed as a `GoodsReceipt`. */
const WITH_DETAILS = {
  purchaseOrder: { select: { number: true } },
  store: { select: { code: true, name: true } },
  receivedBy: { select: { name: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.GoodsReceiptInclude;

type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof WITH_DETAILS }>;

/** Prisma row -> contract shape. */
function toGoodsReceipt(row: ReceiptRow): GoodsReceipt {
  return {
    id: row.id,
    number: row.number,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNumber: row.purchaseOrder.number,
    storeId: row.storeId,
    storeCode: row.store.code,
    storeName: row.store.name,
    receivedById: row.receivedById,
    receivedByName: row.receivedBy.name,
    receivedAt: row.receivedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      unit: line.unit,
      quantity: line.quantity,
    })),
  };
}

@Controller()
export class GoodsReceiptsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
    private readonly ledger: StockLedgerService,
  ) {}

  @Roles('STORE_EMPLOYEE')
  @Implement(contract.goodsReceipts.confirm)
  confirm(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.confirm).handler(({ input }) =>
      this.prisma.$transaction(async (tx) => {
        const order = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: input.purchaseOrderId },
          include: { lines: true },
        });
        const received = input.lines.filter((line) => line.quantity > 0);

        for (const line of received) {
          await tx.purchaseOrderLine.update({
            where: { id: line.purchaseOrderLineId },
            data: { receivedQuantity: { increment: line.quantity } },
          });
        }

        const number = await this.numbering.next(tx, NUMBER_PREFIX);
        const receipt = await tx.goodsReceipt.create({
          data: {
            number,
            purchaseOrderId: order.id,
            storeId: order.storeId,
            receivedById: user.id,
            lines: {
              create: received.map((line) => {
                const orderLine = order.lines.find((l) => l.id === line.purchaseOrderLineId)!;
                return {
                  purchaseOrderLineId: orderLine.id,
                  productId: orderLine.productId,
                  sku: orderLine.sku,
                  productName: orderLine.productName,
                  unit: orderLine.unit,
                  quantity: line.quantity,
                };
              }),
            },
          },
          include: WITH_DETAILS,
        });

        for (const line of received) {
          const orderLine = order.lines.find((l) => l.id === line.purchaseOrderLineId)!;
          await this.ledger.post(tx, {
            productId: orderLine.productId,
            storeId: order.storeId,
            quantityChange: line.quantity,
            movementType: 'RECEIPT',
            sourceDocumentType: MOVEMENT_DOCUMENT_TYPE,
            sourceDocumentNumber: number,
            actorId: user.id,
          });
        }

        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: 'PARTIALLY_RECEIVED' },
        });
        return toGoodsReceipt(receipt);
      }),
    );
  }
}
