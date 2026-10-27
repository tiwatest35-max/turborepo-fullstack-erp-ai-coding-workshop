import { Controller } from '@nestjs/common';
import { apiError, contract, type Product } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/** The Prisma error code, if this is a Prisma known-request error. */
function prismaCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

/** P2002 = unique-constraint violation (duplicate SKU). */
const UNIQUE_VIOLATION = 'P2002';
/** P2003 = foreign-key violation (a threshold names a store that does not exist). */
const FOREIGN_KEY_VIOLATION = 'P2003';
/** P2025 = an operation needed a row that does not exist. */
const RECORD_NOT_FOUND = 'P2025';

const skuTaken = (sku: string | undefined) =>
  apiError(
    'PRODUCT_SKU_TAKEN',
    sku ? `รหัส SKU ${sku} ถูกใช้แล้ว` : 'รหัส SKU นี้ถูกใช้แล้ว',
    'correct_input',
  );
const STORE_UNKNOWN = apiError(
  'PRODUCT_STORE_UNKNOWN',
  'ไม่พบสาขาที่ระบุในค่าจุดสั่งซื้อ',
  'correct_input',
);
const NOT_FOUND = apiError('PRODUCT_NOT_FOUND', 'ไม่พบสินค้าที่ระบุ', 'correct_input');

/** What the queries ask Prisma to load so a row can be exposed as a `Product`. */
const WITH_THRESHOLDS = { reorderThresholds: true } as const;

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: { toString(): string };
  active: boolean;
  reorderThresholds: { storeId: string; threshold: number }[];
};

/** Prisma row -> contract shape: Decimal price becomes a number, join rows lose their keys. */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    sellingPrice: Number(row.sellingPrice.toString()),
    active: row.active,
    reorderThresholds: row.reorderThresholds.map(({ storeId, threshold }) => ({
      storeId,
      threshold,
    })),
  };
}

@Controller()
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.products.list)
  list() {
    return implement(contract.products.list).handler(async ({ input }) => {
      const { page, pageSize, search, status } = input;
      // `all` adds no active filter: a deactivated product stays searchable (MD-02).
      const where = {
        ...(status === 'all' ? {} : { active: status === 'active' }),
        ...(search
          ? {
              OR: [
                { sku: { contains: search, mode: 'insensitive' as const } },
                { name: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        this.prisma.product.findMany({
          where,
          include: WITH_THRESHOLDS,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.product.count({ where }),
      ]);

      return {
        items: rows.map(toProduct),
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + rows.length < total,
      };
    });
  }

  @Implement(contract.products.get)
  get() {
    return implement(contract.products.get).handler(async ({ input, errors }) => {
      try {
        const row = await this.prisma.product.findUniqueOrThrow({
          where: { id: input.id },
          include: WITH_THRESHOLDS,
        });
        return toProduct(row);
      } catch (error) {
        if (prismaCode(error) === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // a real failure (e.g. DB down) must not read as "not found"
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.products.create)
  create() {
    return implement(contract.products.create).handler(async ({ input, errors }) => {
      const { reorderThresholds, ...fields } = input;
      try {
        const row = await this.prisma.product.create({
          data: { ...fields, reorderThresholds: { create: reorderThresholds } },
          include: WITH_THRESHOLDS,
        });
        return toProduct(row);
      } catch (error) {
        const code = prismaCode(error);
        if (code === UNIQUE_VIOLATION) throw errors.CONFLICT({ data: skuTaken(input.sku) });
        if (code === FOREIGN_KEY_VIOLATION) throw errors.BAD_REQUEST({ data: STORE_UNKNOWN });
        throw error;
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.products.update)
  update() {
    return implement(contract.products.update).handler(async ({ input, errors }) => {
      const { id, reorderThresholds, ...fields } = input;
      try {
        const row = await this.prisma.product.update({
          where: { id },
          data: {
            ...fields,
            // Sent thresholds replace the product's whole set; absent leaves them alone.
            ...(reorderThresholds && {
              reorderThresholds: { deleteMany: {}, create: reorderThresholds },
            }),
          },
          include: WITH_THRESHOLDS,
        });
        return toProduct(row);
      } catch (error) {
        const code = prismaCode(error);
        if (code === UNIQUE_VIOLATION) throw errors.CONFLICT({ data: skuTaken(input.sku) });
        if (code === FOREIGN_KEY_VIOLATION) throw errors.BAD_REQUEST({ data: STORE_UNKNOWN });
        if (code === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // unexpected failures propagate instead of masking as NOT_FOUND
      }
    });
  }
}
