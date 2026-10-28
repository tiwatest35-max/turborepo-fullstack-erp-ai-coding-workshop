import { createHash } from 'node:crypto';
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

/** The idempotency-key namespace for confirming goods receipts. */
const IDEMPOTENCY_OPERATION = 'GOODS_RECEIPT';

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

const RECEIPT_NOT_FOUND = apiError(
  'GR_RECEIPT_NOT_FOUND',
  'ไม่พบใบรับสินค้าที่ระบุ',
  'correct_input',
);
const IDEMPOTENCY_REUSED = apiError(
  'GR_IDEMPOTENCY_REUSED',
  'คีย์นี้ถูกใช้กับคำขออื่นแล้ว โปรดใช้คีย์ใหม่สำหรับการรับสินค้าครั้งใหม่',
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

/** A stable fingerprint of who asked and what they asked for, to catch a key reused for a different request. */
function hashRequest(input: ConfirmInput, userId: string): string {
  const canonical = JSON.stringify({
    userId,
    purchaseOrderId: input.purchaseOrderId,
    lines: [...input.lines]
      .sort((a, b) => a.purchaseOrderLineId.localeCompare(b.purchaseOrderLineId))
      .map((l) => [l.purchaseOrderLineId, l.quantity]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

type ConfirmInput = {
  purchaseOrderId: string;
  idempotencyKey: string;
  lines: { purchaseOrderLineId: string; quantity: number }[];
};

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

        // Idempotency (GR-04): a repeat of the same key returns the first receipt; the same key
        // reused for a different request is rejected; a new key makes a new receipt. The order's
        // FOR UPDATE lock above serializes concurrent receipts, so this read-then-claim is safe.
        const requestHash = hashRequest(input, user.id);
        const existingKey = await tx.idempotencyKey.findUnique({
          where: { operation_key: { operation: IDEMPOTENCY_OPERATION, key: input.idempotencyKey } },
        });
        if (existingKey) {
          if (existingKey.requestHash !== requestHash) {
            throw errors.CONFLICT({ data: IDEMPOTENCY_REUSED });
          }
          // Same key, same request: replay the first receipt instead of posting again.
          const prior = await tx.goodsReceipt.findUniqueOrThrow({
            where: { id: existingKey.resultId! },
            include: WITH_DETAILS,
          });
          return toGoodsReceipt(prior);
        }
        await tx.idempotencyKey.create({
          data: { operation: IDEMPOTENCY_OPERATION, key: input.idempotencyKey, requestHash },
        });

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

        // Point the idempotency key at the receipt it produced, so a replay returns it.
        await tx.idempotencyKey.update({
          where: { operation_key: { operation: IDEMPOTENCY_OPERATION, key: input.idempotencyKey } },
          data: { resultId: receipt.id },
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

  /** The receiving screen (GR-01): the employee's Approved/Partially Received orders, with outstanding per line. */
  @Roles('STORE_EMPLOYEE')
  @Implement(contract.goodsReceipts.receivable)
  receivable(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.receivable).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const where: Prisma.PurchaseOrderWhereInput = {
        storeId: user.storeId ?? undefined,
        status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] },
      };
      const [orders, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: {
            supplier: { select: { code: true, name: true } },
            store: { select: { code: true, name: true } },
            lines: { orderBy: { id: 'asc' } },
          },
        }),
        this.prisma.purchaseOrder.count({ where }),
      ]);

      const items = orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status as 'APPROVED' | 'PARTIALLY_RECEIVED',
        supplierCode: order.supplier.code,
        supplierName: order.supplier.name,
        storeId: order.storeId,
        storeCode: order.store.code,
        storeName: order.store.name,
        expectedReceiptDate: order.expectedReceiptDate.toISOString().slice(0, 10),
        lines: order.lines.map((line) => ({
          id: line.id,
          productId: line.productId,
          sku: line.sku,
          productName: line.productName,
          unit: line.unit,
          ordered: line.quantity,
          received: line.receivedQuantity,
          outstanding: line.quantity - line.receivedQuantity,
        })),
      }));
      return {
        items,
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + items.length < total,
      };
    });
  }

  @Roles('STORE_EMPLOYEE', 'MANAGER', 'ADMIN')
  @Implement(contract.goodsReceipts.list)
  list(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.list).handler(async ({ input }) => {
      const { page, pageSize, purchaseOrderId } = input;
      // Store employees are confined to their own store; managers and admins see all.
      const scopedStoreId =
        user.role === 'STORE_EMPLOYEE' ? (user.storeId ?? undefined) : undefined;
      const where: Prisma.GoodsReceiptWhereInput = {
        storeId: scopedStoreId ?? input.storeId,
        purchaseOrderId,
      };
      const [rows, total] = await Promise.all([
        this.prisma.goodsReceipt.findMany({
          where,
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: WITH_DETAILS,
        }),
        this.prisma.goodsReceipt.count({ where }),
      ]);
      const items = rows.map(toGoodsReceipt);
      return {
        items,
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + items.length < total,
      };
    });
  }

  @Roles('STORE_EMPLOYEE', 'MANAGER', 'ADMIN')
  @Implement(contract.goodsReceipts.get)
  get(@CurrentUser() user: User) {
    return implement(contract.goodsReceipts.get).handler(async ({ input, errors }) => {
      const row = await this.prisma.goodsReceipt.findUnique({
        where: { id: input.id },
        include: WITH_DETAILS,
      });
      if (!row) throw errors.NOT_FOUND({ data: RECEIPT_NOT_FOUND });
      // A store employee may only read receipts for their assigned store.
      if (user.role === 'STORE_EMPLOYEE' && row.storeId !== user.storeId) {
        throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });
      }
      return toGoodsReceipt(row);
    });
  }
}
