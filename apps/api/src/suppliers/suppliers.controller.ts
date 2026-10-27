import { Controller } from '@nestjs/common';
import { apiError, contract } from '@erp/contracts';
import { Implement, implement } from '@orpc/nest';
import { Roles } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';

/** True when a Prisma error is a unique-constraint violation (duplicate code). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

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
      } catch {
        throw errors.NOT_FOUND({
          data: apiError('SUPPLIER_NOT_FOUND', 'ไม่พบผู้จัดจำหน่ายที่ระบุ', 'correct_input'),
        });
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
        if (isUniqueViolation(error)) {
          throw errors.CONFLICT({
            data: apiError(
              'SUPPLIER_CODE_TAKEN',
              'รหัสผู้จัดจำหน่ายนี้ถูกใช้แล้ว',
              'correct_input',
            ),
          });
        }
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
        if (isUniqueViolation(error)) {
          throw errors.CONFLICT({
            data: apiError(
              'SUPPLIER_CODE_TAKEN',
              'รหัสผู้จัดจำหน่ายนี้ถูกใช้แล้ว',
              'correct_input',
            ),
          });
        }
        throw errors.NOT_FOUND({
          data: apiError('SUPPLIER_NOT_FOUND', 'ไม่พบผู้จัดจำหน่ายที่ระบุ', 'correct_input'),
        });
      }
    });
  }
}
