import { Controller } from '@nestjs/common';
import { apiError, contract, type DailySales, type User } from '@erp/contracts';
import { Prisma } from '@erp/database';
import { Implement, implement } from '@orpc/nest';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/** Asia/Bangkok is UTC+7 all year; Thailand has no daylight saving time. */
const BANGKOK_OFFSET = '+07:00';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The half-open UTC interval [start, end) covering the Bangkok days `from` to `to`, both included.
 * A Bangkok day runs from 00:00:00 inclusive to the next day 00:00:00 exclusive.
 */
function bangkokRange(from: string, to: string): { start: Date; end: Date } {
  const start = new Date(`${from}T00:00:00${BANGKOK_OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${BANGKOK_OFFSET}`).getTime() + DAY_MS);
  return { start, end };
}

const STORE_FORBIDDEN = apiError(
  'REPORT_STORE_FORBIDDEN',
  '????????????????????????????????????????????',
  'correct_input',
);

/** What one grouped row of the aggregate query holds. `total` is text so it never loses a satang. */
type DayRow = { date: string; documentCount: number; unitsSold: number; total: string };

/** THB amounts are summed in whole satang, so adding them never picks up float noise. */
const toSatang = (amount: string) => Math.round(Number(amount) * 100);

@Controller()
export class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  /** The daily sales report (RPT-01): confirmed sales only, grouped by Asia/Bangkok day. */
  @Roles('STORE_EMPLOYEE', 'MANAGER', 'ADMIN')
  @Implement(contract.reports.dailySales)
  dailySales(@CurrentUser() user: User) {
    return implement(contract.reports.dailySales).handler(async ({ input, errors }) => {
      const { start, end } = bangkokRange(input.from, input.to);

      // A store employee is pinned to their own store and cannot widen it through the input; one
      // with no store sees nothing. Managers and admins see every store, optionally narrowed.
      let storeId: string | undefined;
      if (user.role === 'STORE_EMPLOYEE') {
        if (!user.storeId) throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });
        storeId = user.storeId;
      } else {
        storeId = input.storeId;
      }
      const inStore = storeId ? Prisma.sql`AND "s"."storeId" = ${storeId}` : Prisma.empty;

      // "soldAt" is a UTC timestamp without a zone: read it as UTC first, then as Bangkok time.
      // Every stored sale was confirmed, so there is no status to filter on (drafts are not stored).
      const rows = await this.prisma.$queryRaw<DayRow[]>`
        SELECT to_char(("s"."soldAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS "date",
               COUNT(DISTINCT "s"."id")::int AS "documentCount",
               SUM("l"."quantity")::int AS "unitsSold",
               SUM("l"."quantity" * "l"."unitPrice")::text AS "total"
        FROM "Sale" "s"
        JOIN "SaleLine" "l" ON "l"."saleId" = "s"."id"
        WHERE "s"."soldAt" >= ${start} AND "s"."soldAt" < ${end} ${inStore}
        GROUP BY 1
        ORDER BY 1 DESC`;

      const days: DailySales[] = rows.map((row) => ({
        date: row.date,
        documentCount: row.documentCount,
        unitsSold: row.unitsSold,
        totalSales: toSatang(row.total) / 100,
      }));
      const sum = (pick: (row: DayRow) => number) =>
        rows.reduce((total, row) => total + pick(row), 0);
      return {
        from: input.from,
        to: input.to,
        totals: {
          documentCount: sum((row) => row.documentCount),
          unitsSold: sum((row) => row.unitsSold),
          totalSales: sum((row) => toSatang(row.total)) / 100,
        },
        days,
      };
    });
  }

  /** The movement-history report (RPT-03): the ledger filtered by product, store, type and date. */
  @Roles('STORE_EMPLOYEE', 'MANAGER', 'ADMIN')
  @Implement(contract.reports.movements)
  movements(@CurrentUser() user: User) {
    return implement(contract.reports.movements).handler(async ({ input, errors }) => {
      const { page, pageSize, productId, movementType } = input;

      // A store employee may only see their own store; asking for another is refused (NFR-01).
      // A store employee with no store sees nothing. Managers and admins see all, optionally
      // narrowed by the requested store.
      let storeId: string | undefined;
      if (user.role === 'STORE_EMPLOYEE') {
        if (!user.storeId) throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });
        if (input.storeId && input.storeId !== user.storeId) {
          throw errors.FORBIDDEN({ data: STORE_FORBIDDEN });
        }
        storeId = user.storeId;
      } else {
        storeId = input.storeId;
      }

      // The date range is a half-open Asia/Bangkok interval on the movement time (RPT-03).
      const range =
        input.from && input.to
          ? bangkokRange(input.from, input.to)
          : input.from
            ? bangkokRange(input.from, input.from)
            : input.to
              ? bangkokRange(input.to, input.to)
              : undefined;

      const where: Prisma.StockMovementWhereInput = {
        ...(productId && { productId }),
        ...(storeId && { storeId }),
        ...(movementType && { movementType }),
        ...(range && { createdAt: { gte: range.start, lt: range.end } }),
      };

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
}
