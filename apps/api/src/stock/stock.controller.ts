import { Controller } from '@nestjs/common';
import { apiError, contract, type User } from '@erp/contracts';
import { Prisma } from '@erp/database';
import { Implement, implement } from '@orpc/nest';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import { InsufficientStockError, StockLedgerService } from './stock-ledger.service.js';

const STORE_FORBIDDEN = apiError(
  'STOCK_STORE_FORBIDDEN',
  'คุณดูสต็อกของสาขาอื่นไม่ได้ เลือกสาขาของคุณ',
  'correct_input',
);

/** A manager adjustment is numbered ADJ-000001, ADJ-000002, ... for a traceable audit reference. */
const ADJUSTMENT_PREFIX = 'ADJ';
const ADJUSTMENT_DOCUMENT_TYPE = 'STOCK_ADJUSTMENT';
const ADJUSTMENT_TOO_LARGE = apiError(
  'ADJUSTMENT_INSUFFICIENT_STOCK',
  'ลดสต็อกเกินจำนวนคงเหลือไม่ได้ โปรดตรวจสอบจำนวนแล้วลองอีกครั้ง',
  'correct_input',
);

/**
 * Which store a request may look at (NFR-01). A store-bound user (one with a `storeId`) only
 * sees their own store; asking for another one is refused. ADMIN, MANAGER and PURCHASING have
 * no store and may look at any store, or at all of them.
 */
function allowedStore(user: User, requested: string | undefined): string | undefined | 'FORBIDDEN' {
  if (user.storeId === null) return requested;
  if (requested !== undefined && requested !== user.storeId) return 'FORBIDDEN';
  return user.storeId;
}

/** Escape `\`, `%` and `_` so a search term is matched literally by LIKE. */
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;

type StockRow = {
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  quantity: number;
  reorderThreshold: number | null;
};

@Controller()
export class StockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: StockLedgerService,
    private readonly numbering: DocumentNumberingService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Implement(contract.stock.search)
  search(@CurrentUser() user: User) {
    return implement(contract.stock.search).handler(async ({ input, errors }) => {
      const { page, pageSize, search } = input;
      const storeId = allowedStore(user, input.storeId);
      if (storeId === 'FORBIDDEN') throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });

      // Every product in every store, with 0 where no balance row exists yet, so a product
      // that has never been stocked is still found (RPT-02: zero stock stays visible).
      const conditions = [Prisma.sql`TRUE`];
      if (search) {
        const pattern = likePattern(search);
        conditions.push(Prisma.sql`(p."sku" ILIKE ${pattern} OR p."name" ILIKE ${pattern})`);
      }
      if (storeId) conditions.push(Prisma.sql`s."id" = ${storeId}`);
      // Low stock needs a threshold; a missing balance row counts as 0 so zero stock is kept.
      if (input.lowStockOnly) {
        conditions.push(Prisma.sql`COALESCE(b."quantity", 0) <= t."threshold"`);
      }
      const where = Prisma.join(conditions, ' AND ');
      const from = Prisma.sql`
        FROM "Product" p
        CROSS JOIN "Store" s
        LEFT JOIN "StockBalance" b ON b."productId" = p."id" AND b."storeId" = s."id"
        LEFT JOIN "ProductReorderThreshold" t ON t."productId" = p."id" AND t."storeId" = s."id"
        WHERE ${where}`;

      const [rows, counted] = await Promise.all([
        this.prisma.$queryRaw<StockRow[]>`
          SELECT p."id" AS "productId", p."sku", p."name" AS "productName", p."unit",
                 s."id" AS "storeId", s."code" AS "storeCode", s."name" AS "storeName",
                 COALESCE(b."quantity", 0) AS "quantity", t."threshold" AS "reorderThreshold"
          ${from}
          ORDER BY p."createdAt" DESC, p."id" DESC, s."code" ASC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" ${from}`,
      ]);
      const total = counted[0]?.total ?? 0;

      return {
        items: rows.map((row) => ({
          ...row,
          lowStock: row.reorderThreshold !== null && row.quantity <= row.reorderThreshold,
        })),
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  @Implement(contract.stock.movements)
  movements(@CurrentUser() user: User) {
    return implement(contract.stock.movements).handler(async ({ input, errors }) => {
      const { page, pageSize, productId } = input;
      const storeId = allowedStore(user, input.storeId);
      if (storeId === 'FORBIDDEN') throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });

      const where = { ...(productId && { productId }), ...(storeId && { storeId }) };
      const [rows, total] = await Promise.all([
        this.prisma.stockMovement.findMany({
          where,
          include: { store: { select: { code: true } }, actor: { select: { name: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.stockMovement.count({ where }),
      ]);

      return {
        items: rows.map((row) => ({
          id: row.id,
          productId: row.productId,
          productSku: row.productSku,
          productName: row.productName,
          storeId: row.storeId,
          storeCode: row.store.code,
          quantityChange: row.quantityChange,
          balanceBefore: row.balanceBefore,
          balanceAfter: row.balanceAfter,
          movementType: row.movementType,
          sourceDocumentType: row.sourceDocumentType,
          sourceDocumentNumber: row.sourceDocumentNumber,
          actorId: row.actorId,
          actorName: row.actor.name,
          createdAt: row.createdAt.toISOString(),
        })),
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  /** A manager adjusts stock with a mandatory reason (INV-05). */
  @Roles('MANAGER')
  @Implement(contract.stock.adjust)
  adjust(@CurrentUser() user: User) {
    return implement(contract.stock.adjust).handler(({ input, errors }) =>
      this.prisma.$transaction(async (tx) => {
        const number = await this.numbering.next(tx, ADJUSTMENT_PREFIX);

        // The ledger's atomic guard refuses a decrease that would take the balance below zero;
        // the document, the movement and the audit entry all commit or roll back together.
        let movement;
        try {
          movement = await this.ledger.post(tx, {
            productId: input.productId,
            storeId: input.storeId,
            quantityChange: input.quantityChange,
            movementType: 'ADJUSTMENT',
            sourceDocumentType: ADJUSTMENT_DOCUMENT_TYPE,
            sourceDocumentNumber: number,
            actorId: user.id,
          });
        } catch (error) {
          if (error instanceof InsufficientStockError) {
            throw errors.CONFLICT({ data: ADJUSTMENT_TOO_LARGE });
          }
          throw error;
        }

        // The mandatory reason lives in the audit log (the movement ledger has no reason field).
        await this.auditLog.record(tx, {
          actorId: user.id,
          sourceDocumentType: ADJUSTMENT_DOCUMENT_TYPE,
          sourceDocumentNumber: number,
          outcome: 'APPROVED',
          reason: input.reason,
        });

        const [store, actor] = await Promise.all([
          tx.store.findUniqueOrThrow({ where: { id: movement.storeId }, select: { code: true } }),
          tx.user.findUniqueOrThrow({ where: { id: movement.actorId }, select: { name: true } }),
        ]);
        return {
          id: movement.id,
          productId: movement.productId,
          productSku: movement.productSku,
          productName: movement.productName,
          storeId: movement.storeId,
          storeCode: store.code,
          quantityChange: movement.quantityChange,
          balanceBefore: movement.balanceBefore,
          balanceAfter: movement.balanceAfter,
          movementType: movement.movementType,
          sourceDocumentType: movement.sourceDocumentType,
          sourceDocumentNumber: movement.sourceDocumentNumber,
          actorId: movement.actorId,
          actorName: actor.name,
          createdAt: movement.createdAt.toISOString(),
        };
      }),
    );
  }
}
