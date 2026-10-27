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
import { SuppliersController } from './suppliers.controller.js';

const sup = {
  id: 'sup1',
  code: 'SUP01',
  name: 'SupplyOne Co Ltd',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function prismaMock() {
  return {
    supplier: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  };
}

async function createController(prisma = prismaMock()) {
  const moduleRef = await Test.createTestingModule({
    controllers: [SuppliersController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return { controller: moduleRef.get(SuppliersController), prisma };
}

describe('SuppliersController', () => {
  it('creates a supplier with exactly the input data and returns it', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.create.mockResolvedValue(sup);
    const input = {
      code: 'SUP01',
      name: 'SupplyOne Co Ltd',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    };

    const result = await call(controller.create(), input);

    expect(result).toMatchObject({ id: 'sup1', code: 'SUP01', name: 'SupplyOne Co Ltd' });
    // The handler persists exactly the validated input, not a server-assigned id.
    expect(prisma.supplier.create).toHaveBeenCalledWith({ data: input });
  });

  it('rejects a duplicate code with the standard Thai conflict error', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const error = await call(controller.create(), {
      code: 'SUP01',
      name: 'Dup',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    }).catch((e) => e);

    expect(error.code).toBe('CONFLICT');
    // Only the safe, actionable fields — nothing else leaks (NFR-04).
    expect(error.data).toEqual({
      code: 'SUPPLIER_CODE_TAKEN',
      messageTh: expect.any(String),
      action: 'correct_input',
    });
    expect(error.message).not.toContain('P2002');
  });

  it('gets one supplier by id', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue(sup);

    const result = await call(controller.get(), { id: 'sup1' });

    expect(result).toMatchObject({ id: 'sup1', code: 'SUP01' });
    expect(prisma.supplier.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'sup1' } });
  });

  it('returns the standard NOT_FOUND error for a missing supplier', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.findUniqueOrThrow.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'P2025' }),
    );

    const error = await call(controller.get(), { id: 'missing' }).catch((e) => e);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.data).toMatchObject({ action: 'correct_input' });
  });

  it('rethrows an unexpected database error instead of masking it as NOT_FOUND', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.findUniqueOrThrow.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.get(), { id: 'sup1' }).catch((e) => e);

    // A DB outage must not read as "supplier not found, correct your input".
    expect(error.code).not.toBe('NOT_FOUND');
  });

  it('updates a supplier with exactly the editable fields and returns the new details', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.update.mockResolvedValue({ ...sup, contactPhone: '02-999-0000' });

    const result = await call(controller.update(), { id: 'sup1', contactPhone: '02-999-0000' });

    expect(result.contactPhone).toBe('02-999-0000');
    // id goes to `where`, never into `data`.
    expect(prisma.supplier.update).toHaveBeenCalledWith({
      where: { id: 'sup1' },
      data: { contactPhone: '02-999-0000' },
    });
  });

  it('maps a duplicate code on update to the Thai CONFLICT error', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const error = await call(controller.update(), { id: 'sup1', code: 'SUP02' }).catch((e) => e);

    expect(error.code).toBe('CONFLICT');
    expect(error.data).toMatchObject({ code: 'SUPPLIER_CODE_TAKEN', action: 'correct_input' });
  });

  it('maps a missing row on update to the Thai NOT_FOUND error', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.update.mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'P2025' }),
    );

    const error = await call(controller.update(), { id: 'gone', name: 'X' }).catch((e) => e);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.data).toMatchObject({ code: 'SUPPLIER_NOT_FOUND', action: 'correct_input' });
  });

  it('rethrows an unexpected error on update instead of masking it as NOT_FOUND', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.update.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.update(), { id: 'sup1', name: 'X' }).catch((e) => e);

    expect(error.code).not.toBe('NOT_FOUND');
    expect(error.code).not.toBe('CONFLICT');
  });

  it('lists suppliers newest-first in the shared pagination envelope', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.findMany.mockResolvedValue([sup]);
    prisma.supplier.count.mockResolvedValue(1);

    const result = await call(controller.list(), { page: 1, pageSize: 20 });

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, hasMore: false });
    expect(result.items).toHaveLength(1);
    // Newest-first ordering is passed to the database, not done in memory.
    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('paginates a middle page with the right skip and hasMore', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.findMany.mockResolvedValue([sup, sup]);
    prisma.supplier.count.mockResolvedValue(25);

    const result = await call(controller.list(), { page: 2, pageSize: 10 });

    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 25, hasMore: true });
    expect(prisma.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('rejects a non-admin create/update at the guard, enforced on this controller', async () => {
    // Exercises the real AuthGuard over the actual SuppliersController methods —
    // proving criterion 3 (API enforcement), not merely that metadata is present.
    const nonAdmin: User = {
      id: 'u9',
      email: 'buyer01@erp.local',
      name: 'Buyer',
      role: 'PURCHASING',
      storeId: null,
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
        getHandler: () => SuppliersController.prototype[method],
        getClass: () => SuppliersController,
      }) as unknown as ExecutionContext;

    await expect(guard.canActivate(context('create'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('update'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
