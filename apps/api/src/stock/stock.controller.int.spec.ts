import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import type { User } from '@erp/contracts';
import { describe, expect, it } from 'vitest';
import { AuditLogService } from '../audit-log/audit-log.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { DocumentNumberingService } from './document-numbering.service.js';
import { StockController } from './stock.controller.js';
import { StockLedgerService } from './stock-ledger.service.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('StockController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controller() {
    const moduleRef = await Test.createTestingModule({
      controllers: [StockController],
      providers: [
        { provide: PrismaService, useValue: db.prisma },
        StockLedgerService,
        DocumentNumberingService,
        AuditLogService,
      ],
    }).compile();
    return moduleRef.get(StockController);
  }

  const search = async (user: Awaited<ReturnType<typeof db.userByEmail>>, input = {}) =>
    call((await controller()).search(user), { page: 1, pageSize: 20, ...input });
  const movements = async (user: Awaited<ReturnType<typeof db.userByEmail>>, input = {}) =>
    call((await controller()).movements(user), { page: 1, pageSize: 20, ...input });

  describe('search', () => {
    it('finds a SKU in a store with quantity, unit, threshold and no low-stock flag', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      const result = await search(manager, { search: 'SKU001', storeId: b01.id });

      expect(result.items).toEqual([
        expect.objectContaining({
          sku: 'SKU001',
          productName: 'Drinking water pack of 6',
          unit: 'pack',
          storeCode: 'B01',
          quantity: 10,
          reorderThreshold: 3,
          lowStock: false,
        }),
      ]);
      expect(result).toMatchObject({ page: 1, pageSize: 20, total: 1, hasMore: false });
    });

    it('flags low stock when the quantity is at or below the threshold (AC-08)', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      const result = await search(manager, { storeId: b01.id });

      // SKU001 = 10 (above 3), SKU002 = 5 (above 3), SKU003 = 0 (at or below 3).
      expect(
        Object.fromEntries(result.items.map((i) => [i.sku, [i.quantity, i.lowStock]])),
      ).toEqual({ SKU001: [10, false], SKU002: [5, false], SKU003: [0, true] });
    });

    it('lists only low-stock products in a store when asked for the low-stock report (AC-08)', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      const result = await search(manager, { storeId: b01.id, lowStockOnly: true });

      // SKU003 has 0 in B01, at or below the threshold of 3, so it is listed with its zero balance.
      expect(result.items.map((i) => [i.sku, i.quantity, i.reorderThreshold, i.lowStock])).toEqual([
        ['SKU003', 0, 3, true],
      ]);
      expect(result).toMatchObject({ total: 1, hasMore: false });
    });

    it('keeps a zero-stock product in the low-stock report when it matches the search', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      const matching = await search(manager, {
        storeId: b01.id,
        lowStockOnly: true,
        search: 'detergent',
      });
      const other = await search(manager, {
        storeId: b01.id,
        lowStockOnly: true,
        search: 'SKU001',
      });

      expect(matching.items.map((i) => [i.sku, i.quantity])).toEqual([['SKU003', 0]]);
      expect(other.items).toEqual([]);
      expect(other.total).toBe(0);
    });

    it('never calls a product without a reorder threshold low-stock', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      await db.prisma.product.create({
        data: {
          sku: 'SKU-NOTHRESH',
          name: 'No threshold',
          category: 'x',
          unit: 'box',
          sellingPrice: 5,
        },
      });

      const result = await search(manager, { search: 'SKU-NOTHRESH', lowStockOnly: true });

      expect(result.items).toEqual([]);
    });

    it('scopes the low-stock report to a store employee own store (NFR-01)', async () => {
      const staffB02 = await db.userByEmail('staff_b02@erp.local');

      const result = await search(staffB02, { lowStockOnly: true });

      // B02 has zero of every product against a threshold of 3: all three are low there.
      expect(result.items.map((i) => [i.storeCode, i.sku]).sort()).toEqual([
        ['B02', 'SKU001'],
        ['B02', 'SKU002'],
        ['B02', 'SKU003'],
      ]);
    });

    it('flags a quantity exactly equal to the threshold', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });
      const sku002 = await db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU002' } });
      await db.prisma.$transaction((tx) =>
        new StockLedgerService().post(tx, {
          productId: sku002.id,
          storeId: b01.id,
          quantityChange: -2,
          movementType: 'ADJUSTMENT',
          sourceDocumentType: 'ADJUSTMENT',
          actorId: manager.id,
        }),
      );

      const result = await search(manager, { search: 'SKU002', storeId: b01.id });

      expect(result.items[0]).toMatchObject({ quantity: 3, reorderThreshold: 3, lowStock: true });
    });

    it('lists every store for a SKU, showing zero-stock stores too', async () => {
      const manager = await db.userByEmail('manager01@erp.local');

      const result = await search(manager, { search: 'SKU001' });

      expect(result.items.map((i) => [i.storeCode, i.quantity])).toEqual([
        ['B01', 10],
        ['B02', 0],
      ]);
    });

    it('searches the product name case-insensitively', async () => {
      const manager = await db.userByEmail('manager01@erp.local');

      const result = await search(manager, { search: 'TISSUE' });

      expect(result.items.map((i) => i.sku)).toEqual(['SKU002', 'SKU002']);
    });

    it('treats % and _ in the search as plain characters', async () => {
      const manager = await db.userByEmail('manager01@erp.local');

      expect((await search(manager, { search: '%' })).items).toEqual([]);
      expect((await search(manager, { search: 'SKU00_' })).items).toEqual([]);
    });

    it('shows a product that has no balance row yet as zero, not missing', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      await db.prisma.product.create({
        data: { sku: 'SKU-FRESH', name: 'Fresh', category: 'x', unit: 'box', sellingPrice: 5 },
      });

      const result = await search(manager, { search: 'SKU-FRESH' });

      expect(
        result.items.map((i) => [i.storeCode, i.quantity, i.reorderThreshold, i.lowStock]),
      ).toEqual([
        ['B01', 0, null, false],
        ['B02', 0, null, false],
      ]);
    });

    it('keeps a deactivated product searchable', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      await db.prisma.product.update({ where: { sku: 'SKU003' }, data: { active: false } });

      const result = await search(manager, { search: 'SKU003' });

      expect(result.items.length).toBe(2);
    });

    it('paginates newest product first', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });
      await db.prisma.product.create({
        data: { sku: 'SKU-LAST', name: 'Latest', category: 'x', unit: 'box', sellingPrice: 5 },
      });

      const first = await search(manager, { storeId: b01.id, pageSize: 2 });
      const second = await search(manager, { storeId: b01.id, pageSize: 2, page: 2 });

      expect(first.items[0]!.sku).toBe('SKU-LAST');
      expect(first).toMatchObject({ total: 4, hasMore: true });
      expect(second).toMatchObject({ page: 2, total: 4, hasMore: false });
      expect(new Set([...first.items, ...second.items].map((i) => i.sku)).size).toBe(4);
    });

    it('limits a store employee to their own store (NFR-01)', async () => {
      const staffB02 = await db.userByEmail('staff_b02@erp.local');

      const result = await search(staffB02, { search: 'SKU001' });

      expect(result.items.map((i) => [i.storeCode, i.quantity])).toEqual([['B02', 0]]);
    });

    it("refuses a store employee who asks for another store's stock (NFR-01)", async () => {
      const staffB02 = await db.userByEmail('staff_b02@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      const error = await search(staffB02, { storeId: b01.id }).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'FORBIDDEN',
        data: { code: 'STOCK_STORE_FORBIDDEN', action: 'correct_input' },
      });
    });
  });

  describe('movements', () => {
    it('shows the seeded opening movements and no others', async () => {
      const manager = await db.userByEmail('manager01@erp.local');

      const result = await movements(manager);

      // B01 opens with 10 of SKU001 and 5 of SKU002. Zero balances have no movement.
      expect(
        result.items
          .map((m) => [
            m.productSku,
            m.storeCode,
            m.quantityChange,
            m.balanceBefore,
            m.balanceAfter,
          ])
          .sort(),
      ).toEqual([
        ['SKU001', 'B01', 10, 0, 10],
        ['SKU002', 'B01', 5, 0, 5],
      ]);
      expect(result.items[0]).toMatchObject({
        movementType: 'OPENING',
        sourceDocumentType: 'OPENING_BALANCE',
        sourceDocumentNumber: null,
        actorName: 'Manager 01',
      });
      expect(new Date(result.items[0]!.createdAt).getTime()).not.toBeNaN();
    });

    it('lists newest first and filters by product and store', async () => {
      const manager = await db.userByEmail('manager01@erp.local');
      const sku001 = await db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } });
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });
      const b02 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B02' } });
      await db.prisma.$transaction((tx) =>
        new StockLedgerService().post(tx, {
          productId: sku001.id,
          storeId: b01.id,
          quantityChange: 8,
          movementType: 'RECEIPT',
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentNumber: 'GR-000001',
          actorId: manager.id,
        }),
      );

      const forProduct = await movements(manager, { productId: sku001.id, storeId: b01.id });
      const otherStore = await movements(manager, { storeId: b02.id });

      expect(
        forProduct.items.map((m) => [m.movementType, m.quantityChange, m.sourceDocumentNumber]),
      ).toEqual([
        ['RECEIPT', 8, 'GR-000001'],
        ['OPENING', 10, null],
      ]);
      expect(otherStore.items).toEqual([]);
      expect(otherStore.total).toBe(0);
    });

    it("limits a store employee to their own store's history, and refuses another store (NFR-01)", async () => {
      const staffB01 = await db.userByEmail('staff_b01@erp.local');
      const staffB02 = await db.userByEmail('staff_b02@erp.local');
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      expect((await movements(staffB01)).items).toHaveLength(2);
      expect((await movements(staffB02)).items).toEqual([]);
      await expect(movements(staffB02, { storeId: b01.id })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('offers no handler that edits or deletes a movement (INV-02); only the manager adjustment writes', async () => {
      const instance = await controller();

      expect(Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).sort()).toEqual([
        'adjust',
        'constructor',
        'movements',
        'search',
      ]);
    });
  });

  describe('adjust (INV-05)', () => {
    const manager = () => db.userByEmail('manager01@erp.local');
    const skuId = (sku: string) =>
      db.prisma.product.findUniqueOrThrow({ where: { sku } }).then((p) => p.id);
    const b01Id = () =>
      db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } }).then((s) => s.id);
    const b01Stock = async (sku = 'SKU001') =>
      (
        await db.prisma.stockBalance.findFirstOrThrow({
          where: { product: { sku }, store: { code: 'B01' } },
        })
      ).quantity;
    const adjust = async (
      user: User,
      input: { productId: string; storeId: string; quantityChange: number; reason: string },
    ) => call((await controller()).adjust(user), input);

    it('a manager increase creates an ADJUSTMENT movement with before/after and an audit record with the reason', async () => {
      const [productId, storeId] = [await skuId('SKU001'), await b01Id()];

      const movement = await adjust(await manager(), {
        productId,
        storeId,
        quantityChange: 5,
        reason: 'พบของเพิ่มจากการนับสต็อก',
      });

      expect(movement).toMatchObject({
        movementType: 'ADJUSTMENT',
        quantityChange: 5,
        balanceBefore: 10,
        balanceAfter: 15,
        sourceDocumentType: 'STOCK_ADJUSTMENT',
      });
      expect(movement.sourceDocumentNumber).toMatch(/^ADJ-/);
      expect(await b01Stock()).toBe(15);
      const audit = await db.prisma.auditLog.findFirstOrThrow({
        where: { sourceDocumentNumber: movement.sourceDocumentNumber! },
      });
      expect(audit).toMatchObject({
        sourceDocumentType: 'STOCK_ADJUSTMENT',
        reason: 'พบของเพิ่มจากการนับสต็อก',
      });
    });

    it('a manager decrease reduces stock and records a negative movement', async () => {
      const [productId, storeId] = [await skuId('SKU001'), await b01Id()];

      const movement = await adjust(await manager(), {
        productId,
        storeId,
        quantityChange: -4,
        reason: 'ของเสียหาย',
      });

      expect(movement).toMatchObject({ quantityChange: -4, balanceBefore: 10, balanceAfter: 6 });
      expect(await b01Stock()).toBe(6);
    });

    it('rejects a reduction larger than the available balance and changes nothing', async () => {
      const [productId, storeId] = [await skuId('SKU001'), await b01Id()];

      const error = await adjust(await manager(), {
        productId,
        storeId,
        quantityChange: -11,
        reason: 'นับผิด',
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'CONFLICT',
        data: { code: 'ADJUSTMENT_INSUFFICIENT_STOCK' },
      });
      expect(await b01Stock()).toBe(10);
      expect(await db.prisma.stockMovement.count({ where: { movementType: 'ADJUSTMENT' } })).toBe(
        0,
      );
    });

    it('rejects an adjustment with a blank reason through the route, changing nothing', async () => {
      const [productId, storeId] = [await skuId('SKU001'), await b01Id()];

      const error = await call((await controller()).adjust(await manager()), {
        productId,
        storeId,
        quantityChange: 5,
        reason: '   ',
      } as never).catch((e: unknown) => e);

      expect(error).toBeDefined();
      expect(await b01Stock()).toBe(10);
      expect(await db.prisma.stockMovement.count({ where: { movementType: 'ADJUSTMENT' } })).toBe(
        0,
      );
    });

    it('rejects an unknown product with BAD_REQUEST, not a 500', async () => {
      const storeId = await b01Id();

      const error = await adjust(await manager(), {
        productId: 'does-not-exist',
        storeId,
        quantityChange: 5,
        reason: 'ทดสอบ',
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'BAD_REQUEST',
        data: { code: 'ADJUSTMENT_UNKNOWN_TARGET' },
      });
    });

    it('a non-manager cannot adjust stock, enforced at the API', async () => {
      const staff = await db.userByEmail('staff_b01@erp.local');
      const { AuthGuard } = await import('../auth/auth.guard.js');
      const { Reflector } = await import('@nestjs/core');
      const { ForbiddenException } = await import('@nestjs/common');
      const guard = new AuthGuard(
        new Reflector(),
        { user: { findUnique: async () => staff } } as never,
        { get: () => 'test-secret-that-is-at-least-32-characters' } as never,
      );
      const context = {
        switchToHttp: () => ({ getRequest: () => ({ headers: {}, user: staff }) }),
        getHandler: () => StockController.prototype.adjust,
        getClass: () => StockController,
      } as never;

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
