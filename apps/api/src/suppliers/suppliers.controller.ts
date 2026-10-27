import { Controller } from '@nestjs/common';
import { apiError, contract } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/** The Prisma error code, if this is a Prisma known-request error. */
function prismaCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { code?: string }).code
    : undefined;
}

/** P2002 = unique-constraint violation (duplicate code). */
const UNIQUE_VIOLATION = 'P2002';
/** P2025 = an operation needed a row that does not exist. */
const RECORD_NOT_FOUND = 'P2025';

const CODE_TAKEN = apiError(
  'SUPPLIER_CODE_TAKEN',
  'รหัสผู้จัดจำหน่ายนี้ถูกใช้แล้ว',
  'correct_input',
);
const NOT_FOUND = apiError('SUPPLIER_NOT_FOUND', 'ไม่พบผู้จัดจำหน่ายที่ระบุ', 'correct_input');

@Controller()
export class SuppliersController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.suppliers.list)
  list() {
    return implement(contract.suppliers.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const [items, total] = await Promise.all([
        this.prisma.supplier.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.supplier.count(),
      ]);

      return {
        items,
        page,
        pageSize,
        total,
        hasMore: (page - 1) * pageSize + items.length < total,
      };
    });
  }

  @Implement(contract.suppliers.get)
  get() {
    return implement(contract.suppliers.get).handler(async ({ input, errors }) => {
      try {
        return await this.prisma.supplier.findUniqueOrThrow({ where: { id: input.id } });
      } catch (error) {
        if (prismaCode(error) === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // a real failure (e.g. DB down) must not read as "not found"
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.suppliers.create)
  create() {
    return implement(contract.suppliers.create).handler(async ({ input, errors }) => {
      try {
        return await this.prisma.supplier.create({ data: input });
      } catch (error) {
        if (prismaCode(error) === UNIQUE_VIOLATION) throw errors.CONFLICT({ data: CODE_TAKEN });
        throw error;
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.suppliers.update)
  update() {
    return implement(contract.suppliers.update).handler(async ({ input, errors }) => {
      const { id, ...data } = input;
      try {
        return await this.prisma.supplier.update({ where: { id }, data });
      } catch (error) {
        if (prismaCode(error) === UNIQUE_VIOLATION) throw errors.CONFLICT({ data: CODE_TAKEN });
        if (prismaCode(error) === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // unexpected failures propagate instead of masking as NOT_FOUND
      }
    });
  }
}
