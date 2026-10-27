import { Controller } from '@nestjs/common';
import {
  apiError,
  contract,
  type ApiError,
  type PurchaseOrder,
  type PurchaseOrderInput,
  type User,
} from '@erp/contracts';
import { Prisma } from '@erp/database';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';

/** The Prisma error code, if this is a Prisma known-request error. */
function prismaCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

/** P2025 = an operation needed a row that does not exist. */
const RECORD_NOT_FOUND = 'P2025';

/** Purchase orders are numbered PO-000001, PO-000002, ... (TOR 4.3). */
const NUMBER_PREFIX = 'PO';

const NOT_FOUND = apiError('PO_NOT_FOUND', 'ไม่พบใบสั่งซื้อที่ระบุ', 'correct_input');
const NOT_DRAFT = apiError(
  'PO_NOT_DRAFT',
  'แก้ไขหรือส่งอนุมัติได้เฉพาะใบสั่งซื้อที่ยังเป็นฉบับร่าง',
  'correct_input',
);
const SUPPLIER_UNKNOWN = apiError(
  'PO_SUPPLIER_UNKNOWN',
  'ไม่พบผู้จัดจำหน่ายที่ระบุ',
  'correct_input',
);
const STORE_UNKNOWN = apiError('PO_STORE_UNKNOWN', 'ไม่พบสาขาปลายทางที่ระบุ', 'correct_input');
const PRODUCT_UNKNOWN = apiError('PO_PRODUCT_UNKNOWN', 'ไม่พบสินค้าที่ระบุ', 'correct_input');
const productInactive = (sku: string) =>
  apiError(
    'PO_PRODUCT_INACTIVE',
    `สินค้า ${sku} ปิดใช้งานแล้ว เพิ่มลงใบสั่งซื้อไม่ได้`,
    'correct_input',
  );

/** What the queries load so a row can be exposed as a `PurchaseOrder`. */
const WITH_DETAILS = {
  supplier: { select: { code: true, name: true } },
  store: { select: { code: true, name: true } },
  createdBy: { select: { name: true } },
  lines: { orderBy: { id: 'asc' } },
} satisfies Prisma.PurchaseOrderInclude;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof WITH_DETAILS }>;

/** THB amounts in whole satang, so adding them up never picks up floating-point noise. */
const toSatang = (amount: { toString(): string }) => Math.round(Number(amount.toString()) * 100);

/** Prisma row -> contract shape. Lines show what was saved with them, never the live product. */
function toPurchaseOrder(row: OrderRow): PurchaseOrder {
  const lines = row.lines.map((line) => {
    const lineSatang = line.quantity * toSatang(line.unitPrice);
    return {
      id: line.id,
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: toSatang(line.unitPrice) / 100,
      lineAmount: lineSatang / 100,
      lineSatang,
    };
  });
  const totalSatang = lines.reduce((sum, line) => sum + line.lineSatang, 0);

  return {
    id: row.id,
    number: row.number,
    status: row.status,
    supplierId: row.supplierId,
    supplierCode: row.supplier.code,
    supplierName: row.supplier.name,
    storeId: row.storeId,
    storeCode: row.store.code,
    storeName: row.store.name,
    expectedReceiptDate: row.expectedReceiptDate.toISOString().slice(0, 10),
    createdById: row.createdById,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    lines: lines.map(({ lineSatang: _lineSatang, ...line }) => line),
    totalAmount: totalSatang / 100,
  };
}

/** A typed `errors.BAD_REQUEST` from the handler. */
type BadRequest = (options: { data: ApiError }) => Error;

@Controller()
export class PurchaseOrdersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  /**
   * Checks a draft's contents against the master data and copies each product's SKU, name and
   * unit onto its line (TOR 4.3). Runs inside the caller's transaction and share-locks the
   * products first, so a product cannot be deactivated or renamed between this check and the
   * line being saved, and its SKU is locked from the moment a line points at it (MD-01, MD-02).
   */
  private async resolveContents(
    tx: Prisma.TransactionClient,
    input: PurchaseOrderInput,
    badRequest: BadRequest,
  ) {
    const [supplier, store] = await Promise.all([
      tx.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true } }),
      tx.store.findUnique({ where: { id: input.storeId }, select: { id: true } }),
    ]);
    if (!supplier) throw badRequest({ data: SUPPLIER_UNKNOWN });
    if (!store) throw badRequest({ data: STORE_UNKNOWN });

    const productIds = input.lines.map((line) => line.productId);
    await tx.$queryRaw`
      SELECT "id" FROM "Product" WHERE "id" IN (${Prisma.join(productIds)}) FOR SHARE`;
    const products = new Map(
      (await tx.product.findMany({ where: { id: { in: productIds } } })).map((p) => [p.id, p]),
    );

    return input.lines.map((line) => {
      const product = products.get(line.productId);
      if (!product) throw badRequest({ data: PRODUCT_UNKNOWN });
      if (!product.active) throw badRequest({ data: productInactive(product.sku) });
      return {
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        unit: product.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      };
    });
  }

  @Roles('PURCHASING', 'MANAGER', 'ADMIN')
  @Implement(contract.purchaseOrders.list)
  list() {
    return implement(contract.purchaseOrders.list).handler(async ({ input }) => {
      const { page, pageSize, status } = input;
      const where = status ? { status } : {};
      const [rows, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          where,
          include: WITH_DETAILS,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.purchaseOrder.count({ where }),
      ]);

      return {
        items: rows.map(toPurchaseOrder),
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  @Roles('PURCHASING', 'MANAGER', 'ADMIN')
  @Implement(contract.purchaseOrders.get)
  get() {
    return implement(contract.purchaseOrders.get).handler(async ({ input, errors }) => {
      try {
        const row = await this.prisma.purchaseOrder.findUniqueOrThrow({
          where: { id: input.id },
          include: WITH_DETAILS,
        });
        return toPurchaseOrder(row);
      } catch (error) {
        if (prismaCode(error) === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // a real failure (e.g. DB down) must not read as "not found"
      }
    });
  }

  @Roles('PURCHASING')
  @Implement(contract.purchaseOrders.create)
  create(@CurrentUser() user: User) {
    return implement(contract.purchaseOrders.create).handler(({ input, errors }) =>
      this.prisma.$transaction(async (tx) => {
        const lines = await this.resolveContents(tx, input, errors.BAD_REQUEST);
        // Numbered in the same transaction: a rejected order does not use up a number.
        const number = await this.numbering.next(tx, NUMBER_PREFIX);
        const row = await tx.purchaseOrder.create({
          data: {
            number,
            supplierId: input.supplierId,
            storeId: input.storeId,
            expectedReceiptDate: new Date(`${input.expectedReceiptDate}T00:00:00.000Z`),
            createdById: user.id,
            lines: { create: lines },
          },
          include: WITH_DETAILS,
        });
        return toPurchaseOrder(row);
      }),
    );
  }

  @Roles('PURCHASING')
  @Implement(contract.purchaseOrders.update)
  update() {
    return implement(contract.purchaseOrders.update).handler(({ input, errors }) =>
      this.prisma.$transaction(async (tx) => {
        const { id, ...contents } = input;
        const existing = await tx.purchaseOrder.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!existing) throw errors.NOT_FOUND({ data: NOT_FOUND });
        if (existing.status !== 'DRAFT') throw errors.CONFLICT({ data: NOT_DRAFT });

        const lines = await this.resolveContents(tx, contents, errors.BAD_REQUEST);
        // Claiming the row while it is still a draft also stops a submit that is racing us.
        const claimed = await tx.purchaseOrder.updateMany({
          where: { id, status: 'DRAFT' },
          data: {
            supplierId: contents.supplierId,
            storeId: contents.storeId,
            expectedReceiptDate: new Date(`${contents.expectedReceiptDate}T00:00:00.000Z`),
          },
        });
        if (claimed.count === 0) throw errors.CONFLICT({ data: NOT_DRAFT });

        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((line) => ({ ...line, purchaseOrderId: id })),
        });
        const row = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id },
          include: WITH_DETAILS,
        });
        return toPurchaseOrder(row);
      }),
    );
  }

  @Roles('PURCHASING')
  @Implement(contract.purchaseOrders.submit)
  submit() {
    return implement(contract.purchaseOrders.submit).handler(({ input, errors }) =>
      this.prisma.$transaction(async (tx) => {
        // Only a draft moves on, and only once, even when two requests race.
        const moved = await tx.purchaseOrder.updateMany({
          where: { id: input.id, status: 'DRAFT' },
          data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
        });
        if (moved.count === 0) {
          const exists = await tx.purchaseOrder.count({ where: { id: input.id } });
          throw exists === 0
            ? errors.NOT_FOUND({ data: NOT_FOUND })
            : errors.CONFLICT({ data: NOT_DRAFT });
        }

        const row = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: input.id },
          include: WITH_DETAILS,
        });
        return toPurchaseOrder(row);
      }),
    );
  }
}
