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

const CODE_TAKEN = apiError('STORE_CODE_TAKEN', 'รหัสสาขานี้ถูกใช้แล้ว', 'correct_input');
const NOT_FOUND = apiError('STORE_NOT_FOUND', 'ไม่พบสาขาที่ระบุ', 'correct_input');

@Controller()
export class StoresController {
  constructor(private readonly prisma: PrismaService) {}

  @Implement(contract.stores.list)
  list() {
    return implement(contract.stores.list).handler(async ({ input }) => {
      const { page, pageSize } = input;
      const [items, total] = await Promise.all([
        this.prisma.store.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        this.prisma.store.count(),
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

  @Implement(contract.stores.get)
  get() {
    return implement(contract.stores.get).handler(async ({ input, errors }) => {
      try {
        return await this.prisma.store.findUniqueOrThrow({ where: { id: input.id } });
      } catch (error) {
        if (prismaCode(error) === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // a real failure (e.g. DB down) must not read as "not found"
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.stores.create)
  create() {
    return implement(contract.stores.create).handler(async ({ input, errors }) => {
      try {
        return await this.prisma.store.create({ data: input });
      } catch (error) {
        if (prismaCode(error) === UNIQUE_VIOLATION) throw errors.CONFLICT({ data: CODE_TAKEN });
        throw error;
      }
    });
  }

  @Roles('ADMIN')
  @Implement(contract.stores.update)
  update() {
    return implement(contract.stores.update).handler(async ({ input, errors }) => {
      const { id, ...data } = input;
      try {
        return await this.prisma.store.update({ where: { id }, data });
      } catch (error) {
        if (prismaCode(error) === UNIQUE_VIOLATION) throw errors.CONFLICT({ data: CODE_TAKEN });
        if (prismaCode(error) === RECORD_NOT_FOUND) throw errors.NOT_FOUND({ data: NOT_FOUND });
        throw error; // unexpected failures propagate instead of masking as NOT_FOUND
      }
    });
  }
}
