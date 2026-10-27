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
import { StoresController } from './stores.controller.js';

const store = {
  id: 'st1',
  code: 'B01',
  name: 'Central Store',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function prismaMock() {
  return {
    store: {
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
    controllers: [StoresController],
    providers: [{ provide: PrismaService, useValue: prisma }],
  }).compile();
  return { controller: moduleRef.get(StoresController), prisma };
}

describe('StoresController', () => {
  it('creates a store with exactly the input data and returns it', async () => {
    const { controller, prisma } = await createController();
    prisma.store.create.mockResolvedValue(store);
    const input = { code: 'B01', name: 'Central Store' };

    const result = await call(controller.create(), input);

    expect(result).toEqual({ id: 'st1', code: 'B01', name: 'Central Store' });
    expect(prisma.store.create).toHaveBeenCalledWith({ data: input });
  });

  it('rejects a duplicate code with the standard Thai conflict error', async () => {
    const { controller, prisma } = await createController();
    prisma.store.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const error = await call(controller.create(), { code: 'B01', name: 'Dup' }).catch((e) => e);

    expect(error.code).toBe('CONFLICT');
    expect(error.data).toEqual({
      code: 'STORE_CODE_TAKEN',
      messageTh: expect.any(String),
      action: 'correct_input',
    });
    expect(error.message).not.toContain('P2002');
  });

  it('rethrows an unexpected error on create instead of masking it as CONFLICT', async () => {
    const { controller, prisma } = await createController();
    prisma.store.create.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.create(), { code: 'B09', name: 'X' }).catch((e) => e);

    expect(error.code).not.toBe('CONFLICT');
  });

  it('gets one store by id', async () => {
    const { controller, prisma } = await createController();
    prisma.store.findUniqueOrThrow.mockResolvedValue(store);

    const result = await call(controller.get(), { id: 'st1' });

    expect(result).toMatchObject({ id: 'st1', code: 'B01' });
    expect(prisma.store.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'st1' } });
  });

  it('returns the standard NOT_FOUND error for a missing store', async () => {
    const { controller, prisma } = await createController();
    prisma.store.findUniqueOrThrow.mockRejectedValue(
      Object.assign(new Error('not found'), { code: 'P2025' }),
    );

    const error = await call(controller.get(), { id: 'missing' }).catch((e) => e);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.data).toMatchObject({ code: 'STORE_NOT_FOUND', action: 'correct_input' });
  });

  it('rethrows an unexpected database error instead of masking it as NOT_FOUND', async () => {
    const { controller, prisma } = await createController();
    prisma.store.findUniqueOrThrow.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.get(), { id: 'st1' }).catch((e) => e);

    expect(error.code).not.toBe('NOT_FOUND');
  });

  it('updates a store with exactly the editable fields and returns the new details', async () => {
    const { controller, prisma } = await createController();
    prisma.store.update.mockResolvedValue({ ...store, name: 'Central Plaza' });

    const result = await call(controller.update(), { id: 'st1', name: 'Central Plaza' });

    expect(result.name).toBe('Central Plaza');
    // id goes to `where`, never into `data`.
    expect(prisma.store.update).toHaveBeenCalledWith({
      where: { id: 'st1' },
      data: { name: 'Central Plaza' },
    });
  });

  it('maps a duplicate code on update to the Thai CONFLICT error', async () => {
    const { controller, prisma } = await createController();
    prisma.store.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const error = await call(controller.update(), { id: 'st1', code: 'B02' }).catch((e) => e);

    expect(error.code).toBe('CONFLICT');
    expect(error.data).toMatchObject({ code: 'STORE_CODE_TAKEN', action: 'correct_input' });
  });

  it('maps a missing row on update to the Thai NOT_FOUND error', async () => {
    const { controller, prisma } = await createController();
    prisma.store.update.mockRejectedValue(Object.assign(new Error('missing'), { code: 'P2025' }));

    const error = await call(controller.update(), { id: 'gone', name: 'X' }).catch((e) => e);

    expect(error.code).toBe('NOT_FOUND');
    expect(error.data).toMatchObject({ code: 'STORE_NOT_FOUND', action: 'correct_input' });
  });

  it('rethrows an unexpected error on update instead of masking it', async () => {
    const { controller, prisma } = await createController();
    prisma.store.update.mockRejectedValue(new Error('connection refused'));

    const error = await call(controller.update(), { id: 'st1', name: 'X' }).catch((e) => e);

    expect(error.code).not.toBe('NOT_FOUND');
    expect(error.code).not.toBe('CONFLICT');
  });

  it('lists stores newest-first in the shared pagination envelope', async () => {
    const { controller, prisma } = await createController();
    prisma.store.findMany.mockResolvedValue([store]);
    prisma.store.count.mockResolvedValue(1);

    const result = await call(controller.list(), { page: 1, pageSize: 20 });

    expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, hasMore: false });
    expect(result.items).toEqual([{ id: 'st1', code: 'B01', name: 'Central Store' }]);
    expect(prisma.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('paginates a middle page with the right skip and hasMore', async () => {
    const { controller, prisma } = await createController();
    prisma.store.findMany.mockResolvedValue([store, store]);
    prisma.store.count.mockResolvedValue(25);

    const result = await call(controller.list(), { page: 2, pageSize: 10 });

    expect(result).toMatchObject({ page: 2, pageSize: 10, total: 25, hasMore: true });
    expect(prisma.store.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it.each(['PURCHASING', 'STORE_EMPLOYEE', 'MANAGER'] as const)(
    'rejects a %s creating or editing stores, enforced by the real guard on this controller',
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
          getHandler: () => StoresController.prototype[method],
          getClass: () => StoresController,
        }) as unknown as ExecutionContext;

      await expect(guard.canActivate(context('create'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard.canActivate(context('update'))).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
});
