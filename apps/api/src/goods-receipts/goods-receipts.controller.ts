import { Controller } from '@nestjs/common';
import { apiError, contract, type GoodsReceipt, type User } from '@erp/contracts';
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

const LINE_NOT_ON_ORDER = apiError(
  'GR_LINE_NOT_ON_ORDER',
  'รับได้เฉพาะสินค้าที่อยู่ในใบสั่งซื้อนี้ ไม่สามารถเพิ่มสินค้าอื่นได้',
  'correct_input',
);
const ORDER_NOT_FOUND = apiError('GR_ORDER_NOT_FOUND', 'ไม่พบใบสั่งซื้อที่ระบุ', 'correct_input');
const STORE_FORBIDDEN = apiError(
  'GR_STORE_FORBIDDEN',
  'รับสินค้าได้เฉพาะสาขาที่ได้รับมอบหมายเท่านั้น',
  'correct_input',
);
const ORDER_NOT_RECEIVABLE = apiError(
  'GR_ORDER_NOT_RECEIVABLE',
  'รับสินค้าได้เฉพาะใบสั่งซื้อที่อนุมัติแล้วหรือรับบางส่วนเท่านั้น',
  'correct_input',
);

/** Only an Approved or Partially Received order can be received against (GR-01). */
const RECEIVABLE_STATUSES = ['APPROVED', 'PARTIALLY_RECEIVED'];
const exceedsOrdered = (sku: string, outstanding: number) =>
  apiError(
    'GR_EXCEEDS_ORDERED',
    `จำนวนที่รับของ ${sku} เกินจำนวนที่สั่ง เหลือรับได้อีก ${outstanding}`,
    'correct_input',
  );

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
    return implement(contract.goodsReceipts.confirm).handler(({ input, errors }) =>
      this.prisma.$transaction(async (tx) => {
        // Receipts for one order take turns: a second one waits here until the first commits,
        // so it sees the quantities the first one received (GR-05).
        await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${input.purchaseOrderId} FOR UPDATE`;
        const order = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          include: { lines: true },
        });
        // No such order: NOT_FOUND, before any numbering or stock side effect.
        if (!order) throw errors.NOT_FOUND({ data: ORDER_NOT_FOUND });

        // A store employee may only receive for their assigned store (AC-04, NFR-01).
        if (user.storeId !== order.storeId) throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });

        // Only an Approved or Partially Received order can be received against (GR-01).
        if (!RECEIVABLE_STATUSES.includes(order.status)) {
          throw errors.CONFLICT({ data: ORDER_NOT_RECEIVABLE });
        }

        const received = input.lines.filter((line) => line.quantity > 0);
        const orderLines = new Map(order.lines.map((line) => [line.id, line]));
        // Every line the client names must be a line of this order, even one received at zero.
        if (input.lines.some((line) => !orderLines.has(line.purchaseOrderLineId))) {
          throw errors.BAD_REQUEST({ data: LINE_NOT_ON_ORDER });
        }

        for (const line of received) {
          const orderLine = orderLines.get(line.purchaseOrderLineId)!;
          // One statement checks and changes the total, so it can never pass the ordered quantity.
          const moved = await tx.purchaseOrderLine.updateMany({
            where: {
              id: orderLine.id,
              receivedQuantity: { lte: orderLine.quantity - line.quantity },
            },
            data: { receivedQuantity: { increment: line.quantity } },
          });
          if (moved.count === 0) {
            const outstanding = orderLine.quantity - orderLine.receivedQuantity;
            throw errors.BAD_REQUEST({ data: exceedsOrdered(orderLine.sku, outstanding) });
          }
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

        // Completed when every line is fully received, otherwise Partially Received (GR-03).
        const outstanding = await tx.purchaseOrderLine.findMany({
          where: { purchaseOrderId: order.id },
          select: { quantity: true, receivedQuantity: true },
        });
        const complete = outstanding.every((line) => line.receivedQuantity === line.quantity);
        await tx.purchaseOrder.update({
          where: { id: order.id },
          data: { status: complete ? 'COMPLETED' : 'PARTIALLY_RECEIVED' },
        });
        return toGoodsReceipt(receipt);
      }),
    );
  }
}
