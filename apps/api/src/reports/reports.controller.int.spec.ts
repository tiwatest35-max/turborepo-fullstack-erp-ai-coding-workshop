import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import type { User } from '@erp/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { ReportsController } from './reports.controller.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('ReportsController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controller() {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: PrismaService, useValue: db.prisma }],
    }).compile();
    return moduleRef.get(ReportsController);
  }

  const manager = () => db.userByEmail('manager01@erp.local');

  const dailySales = async (user: User, input: { from: string; to: string; storeId?: string }) =>
    call((await controller()).dailySales(user), input);

  let numberCounter = 0;

  /**
   * Stores a confirmed sale at an exact UTC instant, priced at each product's current selling
   * price. The API stamps the confirmation time itself, so a report test has to write the row.
   */
  async function seedSale(
    storeCode: string,
    soldAt: string,
    lines: [sku: string, quantity: number][],
    sellerEmail = 'staff_b01@erp.local',
  ) {
    const store = await db.prisma.store.findUniqueOrThrow({ where: { code: storeCode } });
    const seller = await db.prisma.user.findUniqueOrThrow({ where: { email: sellerEmail } });
    return db.prisma.sale.create({
      data: {
        number: `SL-T${String(++numberCounter).padStart(5, '0')}`,
        storeId: store.id,
        soldById: seller.id,
        soldAt: new Date(soldAt),
        lines: {
          create: await Promise.all(
            lines.map(async ([sku, quantity]) => {
              const product = await db.prisma.product.findUniqueOrThrow({ where: { sku } });
              return {
                productId: product.id,
                sku: product.sku,
                productName: product.name,
                unit: product.unit,
                quantity,
                unitPrice: product.sellingPrice,
              };
            }),
          ),
        },
      },
    });
  }

  describe('dailySales', () => {
    it('AC-08: a day with no sales reports zero documents, units and total', async () => {
      const report = await dailySales(await manager(), { from: '2026-10-28', to: '2026-10-28' });

      expect(report).toEqual({
        from: '2026-10-28',
        to: '2026-10-28',
        totals: { documentCount: 0, unitsSold: 0, totalSales: 0 },
        days: [],
      });
    });

    it('puts a sale on the Asia/Bangkok day of its confirmation time, with the day running from 00:00:00 inclusive to the next 00:00:00 exclusive', async () => {
      // SKU001 sells at 60.00 and SKU002 at 35.00. Bangkok is UTC+7, so Bangkok midnight is 17:00Z.
      await seedSale('B01', '2026-10-27T16:59:59.999Z', [['SKU001', 7]]); // 27th, 23:59:59.999
      await seedSale('B01', '2026-10-27T17:00:00.000Z', [['SKU001', 1]]); // 28th, 00:00:00
      await seedSale('B01', '2026-10-28T16:30:00.000Z', [['SKU001', 2]]); // 28th, 23:30
      await seedSale('B01', '2026-10-28T16:59:59.999Z', [['SKU002', 1]]); // 28th, 23:59:59.999
      await seedSale('B01', '2026-10-28T17:00:00.000Z', [['SKU001', 5]]); // 29th, 00:00:00

      const the28th = await dailySales(await manager(), { from: '2026-10-28', to: '2026-10-28' });
      const the29th = await dailySales(await manager(), { from: '2026-10-29', to: '2026-10-29' });

      expect(the28th.totals).toEqual({ documentCount: 3, unitsSold: 4, totalSales: 215 });
      expect(the28th.days).toEqual([
        { date: '2026-10-28', documentCount: 3, unitsSold: 4, totalSales: 215 },
      ]);
      expect(the29th.totals).toEqual({ documentCount: 1, unitsSold: 5, totalSales: 300 });
    });

    it('lists each Bangkok day with sales, newest first, and totals the whole range', async () => {
      await seedSale('B01', '2026-10-26T05:00:00Z', [['SKU001', 1]]); // 26th: 60.00
      await seedSale('B01', '2026-10-28T03:00:00Z', [
        ['SKU001', 2],
        ['SKU002', 3],
      ]); // 28th: 120.00 + 105.00
      await seedSale('B01', '2026-10-28T09:00:00Z', [['SKU002', 1]]); // 28th: 35.00

      const report = await dailySales(await manager(), { from: '2026-10-25', to: '2026-10-29' });

      expect(report.days).toEqual([
        { date: '2026-10-28', documentCount: 2, unitsSold: 6, totalSales: 260 },
        { date: '2026-10-26', documentCount: 1, unitsSold: 1, totalSales: 60 },
      ]);
      expect(report.totals).toEqual({ documentCount: 3, unitsSold: 7, totalSales: 320 });
    });

    it('filters by store, and covers every store when none is chosen', async () => {
      await seedSale('B01', '2026-10-28T03:00:00Z', [['SKU001', 2]], 'staff_b01@erp.local'); // 120
      await seedSale('B02', '2026-10-28T04:00:00Z', [['SKU002', 1]], 'staff_b02@erp.local'); // 35
      const b02 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B02' } });
      const range = { from: '2026-10-28', to: '2026-10-28' };

      const all = await dailySales(await manager(), range);
      const onlyB02 = await dailySales(await manager(), { ...range, storeId: b02.id });

      expect(all.totals).toEqual({ documentCount: 2, unitsSold: 3, totalSales: 155 });
      expect(onlyB02.totals).toEqual({ documentCount: 1, unitsSold: 1, totalSales: 35 });
    });

    it('keeps a store employee to their own store, whatever store they ask for (NFR-01)', async () => {
      await seedSale('B01', '2026-10-28T03:00:00Z', [['SKU001', 2]], 'staff_b01@erp.local'); // 120
      await seedSale('B02', '2026-10-28T04:00:00Z', [['SKU002', 1]], 'staff_b02@erp.local'); // 35
      const b02 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B02' } });
      const range = { from: '2026-10-28', to: '2026-10-28' };

      const asked = await dailySales(await db.userByEmail('staff_b01@erp.local'), {
        ...range,
        storeId: b02.id,
      });
      const unasked = await dailySales(await db.userByEmail('staff_b01@erp.local'), range);

      expect(asked.totals).toEqual({ documentCount: 1, unitsSold: 2, totalSales: 120 });
      expect(unasked.totals).toEqual(asked.totals);
    });

    it('refuses a store employee who is not assigned to a store, instead of showing every store', async () => {
      const unassigned = { ...(await db.userByEmail('staff_b01@erp.local')), storeId: null };

      const error = await dailySales(unassigned, { from: '2026-10-28', to: '2026-10-28' }).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects a first day after the last day', async () => {
      const error = await dailySales(await manager(), {
        from: '2026-10-29',
        to: '2026-10-28',
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('movements (RPT-03)', () => {
    const movements = async (
      user: User,
      input: {
        productId?: string;
        storeId?: string;
        movementType?: 'OPENING' | 'RECEIPT' | 'SALE' | 'ADJUSTMENT';
        from?: string;
        to?: string;
      } = {},
    ) => call((await controller()).movements(user), { page: 1, pageSize: 50, ...input });

    /** Insert a movement row directly, with an explicit UTC time, for filter tests. */
    async function seedMovement(opts: {
      sku: string;
      storeCode: string;
      quantityChange: number;
      movementType: 'OPENING' | 'RECEIPT' | 'SALE' | 'ADJUSTMENT';
      sourceDocumentType: string;
      sourceDocumentNumber?: string | null;
      createdAt: string;
    }) {
      const product = await db.prisma.product.findUniqueOrThrow({ where: { sku: opts.sku } });
      const store = await db.prisma.store.findUniqueOrThrow({ where: { code: opts.storeCode } });
      const actor = await db.prisma.user.findUniqueOrThrow({
        where: { email: 'manager01@erp.local' },
      });
      return db.prisma.stockMovement.create({
        data: {
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          storeId: store.id,
          quantityChange: opts.quantityChange,
          // The DB CHECK requires balanceBefore + quantityChange = balanceAfter, and both >= 0.
          balanceBefore: Math.max(0, -opts.quantityChange),
          balanceAfter: Math.max(0, opts.quantityChange),
          movementType: opts.movementType,
          sourceDocumentType: opts.sourceDocumentType,
          sourceDocumentNumber: opts.sourceDocumentNumber ?? null,
          actorId: actor.id,
          createdAt: new Date(opts.createdAt),
        },
      });
    }

    const staffB01 = () => db.userByEmail('staff_b01@erp.local');
    const staffB02 = () => db.userByEmail('staff_b02@erp.local');

    it('filters by movement type', async () => {
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: 8,
        movementType: 'RECEIPT',
        sourceDocumentType: 'GOODS_RECEIPT',
        sourceDocumentNumber: 'GR-000001',
        createdAt: '2026-10-10T05:00:00.000Z',
      });
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: -2,
        movementType: 'SALE',
        sourceDocumentType: 'SALE',
        sourceDocumentNumber: 'SL-000001',
        createdAt: '2026-10-11T05:00:00.000Z',
      });

      const result = await movements(await manager(), { movementType: 'SALE' });

      expect(result.items.every((m) => m.movementType === 'SALE')).toBe(true);
      expect(result.items.some((m) => m.sourceDocumentNumber === 'SL-000001')).toBe(true);
    });

    it('each entry links to its source document', async () => {
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: 5,
        movementType: 'ADJUSTMENT',
        sourceDocumentType: 'STOCK_ADJUSTMENT',
        sourceDocumentNumber: 'ADJ-000001',
        createdAt: '2026-10-12T05:00:00.000Z',
      });

      const result = await movements(await manager(), { movementType: 'ADJUSTMENT' });

      const adj = result.items.find((m) => m.sourceDocumentNumber === 'ADJ-000001');
      expect(adj).toMatchObject({ sourceDocumentType: 'STOCK_ADJUSTMENT' });
    });

    it('filters by an Asia/Bangkok day range on the movement time', async () => {
      // 2026-10-10T19:00Z is 2026-10-11 02:00 in Bangkok, so it belongs to the 11th.
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: 1,
        movementType: 'ADJUSTMENT',
        sourceDocumentType: 'STOCK_ADJUSTMENT',
        sourceDocumentNumber: 'ADJ-IN',
        createdAt: '2026-10-10T19:00:00.000Z',
      });
      // 2026-10-11T18:00Z is 2026-10-12 01:00 Bangkok, outside a 11th-only range.
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: 1,
        movementType: 'ADJUSTMENT',
        sourceDocumentType: 'STOCK_ADJUSTMENT',
        sourceDocumentNumber: 'ADJ-OUT',
        createdAt: '2026-10-11T18:00:00.000Z',
      });

      const result = await movements(await manager(), { from: '2026-10-11', to: '2026-10-11' });

      const numbers = result.items.map((m) => m.sourceDocumentNumber);
      expect(numbers).toContain('ADJ-IN');
      expect(numbers).not.toContain('ADJ-OUT');
    });

    it('applies product, type and date filters together', async () => {
      const sku001 = await db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } });
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B01',
        quantityChange: -1,
        movementType: 'SALE',
        sourceDocumentType: 'SALE',
        sourceDocumentNumber: 'SL-MATCH',
        createdAt: '2026-10-15T05:00:00.000Z',
      });
      await seedMovement({
        sku: 'SKU002',
        storeCode: 'B01',
        quantityChange: -1,
        movementType: 'SALE',
        sourceDocumentType: 'SALE',
        sourceDocumentNumber: 'SL-OTHERPRODUCT',
        createdAt: '2026-10-15T05:00:00.000Z',
      });

      const result = await movements(await manager(), {
        productId: sku001.id,
        movementType: 'SALE',
        from: '2026-10-15',
        to: '2026-10-15',
      });

      const numbers = result.items.map((m) => m.sourceDocumentNumber);
      expect(numbers).toContain('SL-MATCH');
      expect(numbers).not.toContain('SL-OTHERPRODUCT');
    });

    it('limits a store employee to their own store and lets a manager see all', async () => {
      await seedMovement({
        sku: 'SKU001',
        storeCode: 'B02',
        quantityChange: 3,
        movementType: 'RECEIPT',
        sourceDocumentType: 'GOODS_RECEIPT',
        sourceDocumentNumber: 'GR-B02',
        createdAt: '2026-10-16T05:00:00.000Z',
      });

      const asB01 = await movements(await staffB01());
      const asManager = await movements(await manager());

      expect(asB01.items.every((m) => m.storeCode === 'B01')).toBe(true);
      expect(asManager.items.some((m) => m.storeCode === 'B02')).toBe(true);
    });

    it('refuses a store employee who asks for another store', async () => {
      const b01 = await db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } });

      const error = await movements(await staffB02(), { storeId: b01.id }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
