import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { call } from '@orpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES_KEY } from '../auth/auth.decorators.js';
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
  let reflector: Reflector;
  beforeEach(() => {
    reflector = new Reflector();
  });

  it('creates a supplier and returns it', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.create.mockResolvedValue(sup);

    const result = await call(controller.create(), {
      code: 'SUP01',
      name: 'SupplyOne Co Ltd',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    });

    expect(result).toMatchObject({ id: 'sup1', code: 'SUP01', name: 'SupplyOne Co Ltd' });
    expect(prisma.supplier.create).toHaveBeenCalledOnce();
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
    expect(error.data).toMatchObject({ action: 'correct_input' });
    expect(error.data.messageTh).toBeTruthy();
    expect(error.data).not.toHaveProperty('stack');
  });

  it('gets one supplier by id', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.findUniqueOrThrow.mockResolvedValue(sup);

    const result = await call(controller.get(), { id: 'sup1' });

    expect(result).toMatchObject({ id: 'sup1', code: 'SUP01' });
  });

  it('updates a supplier and returns the new details', async () => {
    const { controller, prisma } = await createController();
    prisma.supplier.update.mockResolvedValue({ ...sup, contactPhone: '02-999-0000' });

    const result = await call(controller.update(), { id: 'sup1', contactPhone: '02-999-0000' });

    expect(result.contactPhone).toBe('02-999-0000');
    expect(prisma.supplier.update).toHaveBeenCalledOnce();
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

  it('restricts create and update to ADMIN at the API', () => {
    // The guard (tested in auth.guard.spec) enforces @Roles; here we assert the
    // controller declares ADMIN-only on the mutating routes, so a non-admin is 403.
    expect(reflector.get(ROLES_KEY, SuppliersController.prototype.create)).toEqual(['ADMIN']);
    expect(reflector.get(ROLES_KEY, SuppliersController.prototype.update)).toEqual(['ADMIN']);
  });
});
