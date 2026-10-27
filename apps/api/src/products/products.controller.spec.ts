import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { User } from '@erp/contracts';
import { call } from '@orpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { type AuthenticatedRequest } from '../auth/auth.decorators.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProductsController } from './products.controller.js';

/** A product row as Prisma returns it: price is a Decimal (stringifies to "60"), thresholds included. */
const row = {
  id: 'p1',
  sku: 'SKU001',
  name: 'Notebook A5',
  category: 'Stationery',
  unit: 'pack',
  sellingPrice: { valueOf: () => '60.00', toString: () => '60.00' },
  active: true,
  reorderThresholds: [{ productId: 'p1', storeId: 'st1', threshold: 3 }],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const exposed = {
  id: 'p1',
  sku: 'SKU001',
  name: 'Notebook A5',
  category: 'Stationery',
  unit: 'pack',
  sellingPrice: 60,
  active: true,
  reorderThresholds: [{ storeId: 'st1', threshold: 3 }],
};

const input = {
  sku: 'SKU001',
  name: 'Notebook A5',
  category: 'Stationery',
  unit: 'pack',
  sellingPrice: 60,
  active: true,
  reorderThresholds: [{ storeId: 'st1', threshold: 3 }],
};

function prismaMock() {
  const prisma = {
    product: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    purchaseOrderLine: { count: vi.fn().mockResolvedValue(0) },
    // An update runs in a transaction; the stub hands the same stubbed client to the callback.
    $transaction: vi.fn((run: (tx: unknown) => unknown) => run(prisma)),
  };
  return prisma;
}

async function createController(prisma = prismaMock()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProductsController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return { controller: moduleRef.get(ProductsController), prisma };
}

const prismaError = (code: string) => Object.assign(new Error(code), { code });

describe('ProductsController', () => {
  it('creates a product with its per-store thresholds and returns the exposed shape', async () => {
    const { controller, prisma } = await createController();
    prisma.product.create.mockResolvedValue(row);

    const result = await call(controller.create(), input);

    expect(result).toEqual(exposed);
    expect(prisma.product.create).toHaveBeenCalledWith({
      data: {
        sku: 'SKU001',
        name: 'Notebook A5',
        category: 'Stationery',
        unit: 'pack',
        sellingPrice: 60,
        active: true,
        reorderThresholds: { create: [{ storeId: 'st1', threshold: 3 }] },
      },
      include: { reorderThresholds: true },
    });
  });

  it('rejects a duplicate SKU with a Thai conflict error that names the SKU', async () => {
    const { controller, prisma } = await createController();
    prisma.product.create.mockRejectedValue(prismaError('P2002'));

    const error = await call(controller.create(), input).catch((e) => e);

    expect(error.code).toBe('CONFLICT');
    expect(error.data).toEqual({
      code: 'PRODUCT_SKU_TAKEN',
      messageTh: expect.stringContaining('SKU001'),
      action: 'correct_input',
    });
    expect(error.message).not.toContain('P2002');
  });

  it('rejects a threshold for an unknown store as a bad request', async () => {
    const { controller, prisma } = await createController();
    prisma.product.create.mockRejectedValue(prismaError('P2003'));

    const error = await call(controller.create(), input).catch((e) => e);

    expect(error.code).toBe('BAD_REQUEST');
    expect(error.data).toMatchObject({ code: 'PRODUCT_STORE_UNKNOWN', action: 'correct_input' });
  });

  it('rethrows an unexpected error on create instead of masking it as CONFLICT', async () => {
    const { controller, prisma } = await createController();
    prisma.product.create.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.create(), input).catch((e) => e);

    expect(error.code).not.toBe('CONFLICT');
    expect(error.code).not.toBe('BAD_REQUEST');
  });

  it('rejects a negative selling price before touching the database', async () => {
    const { controller, prisma } = await createController();

    const error = await call(controller.create(), { ...input, sellingPrice: -1 }).catch((e) => e);

    expect(error.code).toBe('BAD_REQUEST');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rejects a negative or fractional reorder threshold before touching the database', async () => {
    const { controller, prisma } = await createController();

    const negative = await call(controller.create(), {
      ...input,
      reorderThresholds: [{ storeId: 'st1', threshold: -1 }],
    }).catch((e) => e);
    const fractional = await call(controller.create(), {
      ...input,
      reorderThresholds: [{ storeId: 'st1', threshold: 1.5 }],
    }).catch((e) => e);

    expect(negative.code).toBe('BAD_REQUEST');
    expect(fractional.code).toBe('BAD_REQUEST');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('gets one product by id', async () => {
    const { controller, prisma } = await createController();
    prisma.product.findUniqueOrThrow.mockResolvedValue(row);

    const result = await call(controller.get(), { id: 'p1' });

    expect(result).toEqual(exposed);
    expect(prisma.product.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'p1' },
      include: { reorderThresholds: true },
    });
  });

  it('returns the standard NOT_FOUND error for a missing product', async () => {
    const { controller, prisma } = await createController();
    prisma.product.findUniqueOrThrow.mockRejectedValue(prismaError('P2025'));

    const error = await call(controller.get(), { id: 'missing' }).catch((e) => e);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.data).toMatchObject({ code: 'PRODUCT_NOT_FOUND', action: 'correct_input' });
  });

  it('rethrows an unexpected database error instead of masking it as NOT_FOUND', async () => {
    const { controller, prisma } = await createController();
    prisma.product.findUniqueOrThrow.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.get(), { id: 'p1' }).catch((e) => e);

    expect(error.code).not.toBe('NOT_FOUND');
  });

  it('deactivates a product by sending only the active flag', async () => {
    const { controller, prisma } = await createController();
    prisma.product.update.mockResolvedValue({ ...row, active: false });

    const result = await call(controller.update(), { id: 'p1', active: false });

    expect(result.active).toBe(false);
    // id goes to `where`, never into `data`; absent fields are left alone.
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { active: false },
      include: { reorderThresholds: true },
    });
  });

  it('replaces the whole set of thresholds when they are sent on update', async () => {
    const { controller, prisma } = await createController();
    prisma.product.update.mockResolvedValue(row);

    await call(controller.update(), {
      id: 'p1',
      reorderThresholds: [{ storeId: 'st2', threshold: 5 }],
    });

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { reorderThresholds: { deleteMany: {}, create: [{ storeId: 'st2', threshold: 5 }] } },
      include: { reorderThresholds: true },
    });
  });

  it('rejects a negative selling price on update before touching the database', async () => {
    const { controller, prisma } = await createController();

    const error = await call(controller.update(), { id: 'p1', sellingPrice: -5 }).catch((e) => e);

    expect(error.code).toBe('BAD_REQUEST');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('maps a duplicate SKU on update to the Thai CONFLICT error naming the SKU', async () => {
    const { controller, prisma } = await createController();
    prisma.product.update.mockRejectedValue(prismaError('P2002'));

    const error = await call(controller.update(), { id: 'p1', sku: 'SKU002' }).catch((e) => e);

    expect(error.code).toBe('CONFLICT');
    expect(error.data).toMatchObject({
      code: 'PRODUCT_SKU_TAKEN',
      messageTh: expect.stringContaining('SKU002'),
    });
  });

  it('maps a missing row on update to the Thai NOT_FOUND error', async () => {
    const { controller, prisma } = await createController();
    prisma.product.update.mockRejectedValue(prismaError('P2025'));

    const error = await call(controller.update(), { id: 'gone', active: false }).catch((e) => e);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.data).toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it('rethrows an unexpected error on update instead of masking it', async () => {
    const { controller, prisma } = await createController();
    prisma.product.update.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.update(), { id: 'p1', active: false }).catch((e) => e);

    expect(error.code).not.toBe('NOT_FOUND');
    expect(error.code).not.toBe('CONFLICT');
  });

  it('lists products newest-first in the shared envelope, including inactive ones by default', async () => {
    const { controller, prisma } = await createController();
    const inactive = { ...row, id: 'p2', sku: 'SKU002', active: false };
    prisma.product.findMany.mockResolvedValue([inactive, row]);
    prisma.product.count.mockResolvedValue(2);

    const result = await call(controller.list(), { page: 1, pageSize: 20, status: 'all' });

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 2, hasMore: false });
    expect(result.items.map((item) => [item.sku, item.active])).toEqual([
      ['SKU002', false],
      ['SKU001', true],
    ]);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {},
      include: { reorderThresholds: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    });
    expect(prisma.product.count).toHaveBeenCalledWith({ where: {} });
  });

  it('filters by active status', async () => {
    const { controller, prisma } = await createController();
    prisma.product.findMany.mockResolvedValue([row]);
    prisma.product.count.mockResolvedValue(1);

    await call(controller.list(), { page: 1, pageSize: 20, status: 'active' });
    await call(controller.list(), { page: 1, pageSize: 20, status: 'inactive' });

    expect(prisma.product.findMany.mock.calls[0]![0]).toMatchObject({ where: { active: true } });
    expect(prisma.product.findMany.mock.calls[1]![0]).toMatchObject({ where: { active: false } });
  });

  it('searches SKU or name case-insensitively, combined with the status filter', async () => {
    const { controller, prisma } = await createController();
    prisma.product.findMany.mockResolvedValue([row]);
    prisma.product.count.mockResolvedValue(1);

    await call(controller.list(), { page: 1, pageSize: 20, status: 'inactive', search: 'note' });

    const where = {
      active: false,
      OR: [
        { sku: { contains: 'note', mode: 'insensitive' } },
        { name: { contains: 'note', mode: 'insensitive' } },
      ],
    };
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(prisma.product.count).toHaveBeenCalledWith({ where });
  });

  it('paginates a middle page with the right skip and hasMore', async () => {
    const { controller, prisma } = await createController();
    prisma.product.findMany.mockResolvedValue([row, row]);
    prisma.product.count.mockResolvedValue(25);

    const result = await call(controller.list(), { page: 2, pageSize: 10, status: 'all' });

    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 25, hasMore: true });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it.each(['PURCHASING', 'STORE_EMPLOYEE', 'MANAGER'] as const)(
    'rejects a %s creating or editing products, enforced by the real guard on this controller',
    async (role) => {
      const nonAdmin: User = {
        id: 'u9',
        email: 'someone@erp.local',
        name: 'Someone',
        role,
        storeId: role === 'STORE_EMPLOYEE' ? 'st1' : null,
      };
      const guard = new AuthGuard(
        new Reflector(),
        { user: { findUnique: vi.fn().mockResolvedValue(nonAdmin) } } as unknown as PrismaService,
        { get: () => 'test-secret-that-is-at-least-32-characters' } as unknown as ConfigService<
          Env,
          true
        >,
      );
      const context = (method: 'create' | 'update') =>
        ({
          switchToHttp: () => ({
            getRequest: () => ({ headers: {}, user: nonAdmin }) as AuthenticatedRequest,
          }),
          getHandler: () => ProductsController.prototype[method],
          getClass: () => ProductsController,
        }) as unknown as ExecutionContext;

      await expect(guard.canActivate(context('create'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard.canActivate(context('update'))).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
});
