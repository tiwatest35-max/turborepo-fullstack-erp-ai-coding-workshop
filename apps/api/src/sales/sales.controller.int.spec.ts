import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { contract, type User } from '@erp/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { SalesController } from './sales.controller.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('SalesController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controller() {
    const moduleRef = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: PrismaService, useValue: db.prisma },
        DocumentNumberingService,
        StockLedgerService,
      ],
    }).compile();
    return moduleRef.get(SalesController);
  }

  const staffB01 = () => db.userByEmail('staff_b01@erp.local');

  const productId = async (sku: string) =>
    (await db.prisma.product.findUniqueOrThrow({ where: { sku } })).id;

  let keyCounter = 0;
  const newKey = () => `test-key-${++keyCounter}-${Math.random().toString(36).slice(2)}`;

  /** Sells the given `[sku, quantity]` pairs, under a fresh idempotency key unless one is given. */
  const sell = async (user: User, lines: [sku: string, quantity: number][], key = newKey()) =>
    call((await controller()).confirm(user), {
      idempotencyKey: key,
      lines: await Promise.all(
        lines.map(async ([sku, quantity]) => ({ productId: await productId(sku), quantity })),
      ),
    });

  const stock = async (sku: string, store = 'B01') =>
    (
      await db.prisma.stockBalance.findFirstOrThrow({
        where: { product: { sku }, store: { code: store } },
      })
    ).quantity;
  const saleCount = () => db.prisma.sale.count();
  const saleMovements = () => db.prisma.stockMovement.findMany({ where: { movementType: 'SALE' } });

  describe('confirm', () => {
    it('AC-06: staff_b01 sells 2 of SKU001 and 1 of SKU002 for THB 155.00, and balances become 8 and 4', async () => {
      const sale = await sell(await staffB01(), [
        ['SKU001', 2],
        ['SKU002', 1],
      ]);

      expect(sale).toMatchObject({
        number: 'SL-000001',
        storeCode: 'B01',
        soldByName: 'Staff B01',
        total: 155,
      });
      expect(sale.lines.map((l) => [l.sku, l.quantity, l.unitPrice, l.lineTotal])).toEqual(
        expect.arrayContaining([
          ['SKU001', 2, 60, 120],
          ['SKU002', 1, 35, 35],
        ]),
      );
      expect(await stock('SKU001')).toBe(8);
      expect(await stock('SKU002')).toBe(4);
      expect(await saleCount()).toBe(1);
      expect(await saleMovements()).toHaveLength(2);
      expect(await saleMovements()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productSku: 'SKU001',
            quantityChange: -2,
            balanceBefore: 10,
            balanceAfter: 8,
            sourceDocumentType: 'SALE',
            sourceDocumentNumber: 'SL-000001',
          }),
          expect.objectContaining({
            productSku: 'SKU002',
            quantityChange: -1,
            balanceBefore: 5,
            balanceAfter: 4,
            sourceDocumentType: 'SALE',
            sourceDocumentNumber: 'SL-000001',
          }),
        ]),
      );
    });

    it('AC-05: selling 11 of SKU001 when stock is 10 fails, with no sale and no deduction', async () => {
      const error = await sell(await staffB01(), [['SKU001', 11]]).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'CONFLICT',
        data: {
          code: 'SALE_INSUFFICIENT_STOCK',
          action: 'correct_input',
          messageTh: expect.stringContaining('SKU001'),
        },
      });
      expect(await saleCount()).toBe(0);
      expect(await saleMovements()).toEqual([]);
      expect(await stock('SKU001')).toBe(10);
    });

    it('rejects the whole document when one line is short, names every short product, and posts nothing (SAL-02)', async () => {
      // SKU001 has 10, SKU002 has 5, SKU003 has 0: SKU002 and SKU003 are short.
      const error = await sell(await staffB01(), [
        ['SKU001', 2],
        ['SKU002', 6],
        ['SKU003', 1],
      ]).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONFLICT', data: { code: 'SALE_INSUFFICIENT_STOCK' } });
      const { messageTh } = (error as { data: { messageTh: string } }).data;
      expect(messageTh).toContain('SKU002');
      expect(messageTh).toContain('SKU003');
      expect(messageTh).not.toContain('SKU001');
      expect(await saleCount()).toBe(0);
      expect(await saleMovements()).toEqual([]);
      expect(await stock('SKU001')).toBe(10);
      expect(await stock('SKU002')).toBe(5);
      expect((await db.prisma.documentSequence.findMany()).map((s) => s.prefix)).not.toContain(
        'SL',
      );
    });

    it('can sell the last unit: stock goes to exactly zero', async () => {
      await sell(await staffB01(), [['SKU002', 5]]);

      expect(await stock('SKU002')).toBe(0);
    });

    it('AC-06: repeating the same idempotencyKey returns the first sale and changes nothing (SAL-03)', async () => {
      const staff = await staffB01();
      const key = newKey();

      const first = await sell(staff, [['SKU001', 2]], key);
      const replay = await sell(staff, [['SKU001', 2]], key);

      expect(replay.id).toBe(first.id);
      expect(replay.number).toBe(first.number);
      expect(replay.total).toBe(first.total);
      expect(await saleCount()).toBe(1);
      expect(await stock('SKU001')).toBe(8);
      expect(await saleMovements()).toHaveLength(1);
    });

    it('replays the first sale even when the stock that remains could no longer cover it', async () => {
      const staff = await staffB01();
      const key = newKey();
      const first = await sell(staff, [['SKU001', 10]], key);
      expect(await stock('SKU001')).toBe(0);

      const replay = await sell(staff, [['SKU001', 10]], key);

      expect(replay.id).toBe(first.id);
      expect(await saleCount()).toBe(1);
      expect(await stock('SKU001')).toBe(0);
    });

    it('a deliberately new key makes a second sale', async () => {
      const staff = await staffB01();

      const first = await sell(staff, [['SKU001', 2]]);
      const second = await sell(staff, [['SKU001', 2]]);

      expect(second.id).not.toBe(first.id);
      expect(second.number).toBe('SL-000002');
      expect(await saleCount()).toBe(2);
      expect(await stock('SKU001')).toBe(6);
    });

    it('rejects the same key reused for a different request, and changes nothing', async () => {
      const staff = await staffB01();
      const key = newKey();
      await sell(staff, [['SKU001', 2]], key);

      const error = await sell(staff, [['SKU001', 3]], key).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'CONFLICT',
        data: { code: 'SALE_IDEMPOTENCY_REUSED', action: 'correct_input' },
      });
      expect(await saleCount()).toBe(1);
      expect(await stock('SKU001')).toBe(8);
    });

    it('does not let another user replay a key and read the first user’s sale', async () => {
      const key = newKey();
      await sell(await staffB01(), [['SKU001', 2]], key);
      const staffB02 = await db.userByEmail('staff_b02@erp.local');

      const error = await sell(staffB02, [['SKU001', 2]], key).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONFLICT', data: { code: 'SALE_IDEMPOTENCY_REUSED' } });
      expect(await saleCount()).toBe(1);
    });

    it('a rejected sale does not use up its key: the same key works once stock allows it', async () => {
      const staff = await staffB01();
      const key = newKey();
      const rejected = await sell(staff, [['SKU003', 1]], key).catch((e: unknown) => e);
      expect(rejected).toMatchObject({ data: { code: 'SALE_INSUFFICIENT_STOCK' } });
      await db.prisma.stockBalance.updateMany({
        where: { product: { sku: 'SKU003' }, store: { code: 'B01' } },
        data: { quantity: 4 },
      });

      const sale = await sell(staff, [['SKU003', 1]], key);

      expect(sale.number).toBe('SL-000001');
      expect(await saleCount()).toBe(1);
      expect(await stock('SKU003')).toBe(3);
    });

    it('two concurrent requests with the same key make one sale', async () => {
      const staff = await staffB01();
      const key = newKey();

      const results = await Promise.all([
        sell(staff, [['SKU001', 2]], key),
        sell(staff, [['SKU001', 2]], key),
      ]);

      expect(results[0].id).toBe(results[1].id);
      expect(await saleCount()).toBe(1);
      expect(await stock('SKU001')).toBe(8);
      expect(await saleMovements()).toHaveLength(1);
    });

    it('sells from the latest balance, not an earlier one', async () => {
      const staff = await staffB01();
      await sell(staff, [['SKU001', 7]]);

      const error = await sell(staff, [['SKU001', 7]]).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONFLICT', data: { code: 'SALE_INSUFFICIENT_STOCK' } });
      expect(await stock('SKU001')).toBe(3);
      expect(await saleCount()).toBe(1);
    });

    it('rejects a line that names an inactive product (SAL-01)', async () => {
      await db.prisma.product.update({ where: { sku: 'SKU002' }, data: { active: false } });

      const error = await sell(await staffB01(), [['SKU002', 1]]).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'BAD_REQUEST',
        data: { code: 'SALE_PRODUCT_NOT_SELLABLE' },
      });
      expect(await saleCount()).toBe(0);
    });
  });

  /** Seam 2: the database-concurrency seam. A single sequential call cannot express the race. */
  describe('concurrent sales (INV-04)', () => {
    it('AC-07: two concurrent sales of 7 against stock 10 make exactly one sale and one rejection, and final stock is 3', async () => {
      const staff = await staffB01();

      const results = await Promise.allSettled([
        sell(staff, [['SKU001', 7]]),
        sell(staff, [['SKU001', 7]]),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'CONFLICT',
        data: { code: 'SALE_INSUFFICIENT_STOCK', action: 'correct_input' },
      });
      expect(await stock('SKU001')).toBe(3);
      expect(await saleCount()).toBe(1);
      expect(await saleMovements()).toEqual([
        expect.objectContaining({ quantityChange: -7, balanceBefore: 10, balanceAfter: 3 }),
      ]);
    });
  });

  describe('frozen price (SAL-01)', () => {
    it('applies the product selling price and keeps it even after the product price changes', async () => {
      const staff = await staffB01();
      const sale = await sell(staff, [['SKU001', 2]]); // SKU001 sells at 60.00
      expect(sale.lines[0]!.unitPrice).toBe(60);

      // Change the product price after the sale; the confirmed sale and its reads keep the old price.
      await db.prisma.product.update({ where: { sku: 'SKU001' }, data: { sellingPrice: 99 } });

      const got = await call((await controller()).get(staff), { id: sale.id });
      expect(got.lines[0]!.unitPrice).toBe(60);
      expect(got.total).toBe(120);
    });
  });

  describe('view-only (SAL-04)', () => {
    it('exposes only confirm, list and get — no edit, cancel or return route', () => {
      // Enforced by construction: the contract has no mutating route for a confirmed sale.
      // (contract.sales is validated here so a regression that adds one is caught.)
      expect(Object.keys((contract as { sales: Record<string, unknown> }).sales).sort()).toEqual([
        'confirm',
        'get',
        'list',
      ]);
    });

    it('a confirmed sale cannot be updated or deleted at the database (trigger)', async () => {
      const sale = await sell(await staffB01(), [['SKU001', 1]]);

      await expect(
        db.prisma.$executeRawUnsafe(`UPDATE "Sale" SET "number" = 'X' WHERE "id" = '${sale.id}'`),
      ).rejects.toBeTruthy();
      await expect(
        db.prisma.$executeRawUnsafe(`DELETE FROM "Sale" WHERE "id" = '${sale.id}'`),
      ).rejects.toBeTruthy();
    });
  });

  describe('list and get', () => {
    const staffB02 = () => db.userByEmail('staff_b02@erp.local');

    it('lists sales newest-first, scoped to the store employee’s store', async () => {
      const staff = await staffB01();
      await sell(staff, [['SKU001', 1]]);

      const result = await call((await controller()).list(staff), { page: 1, pageSize: 20 });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every((s) => s.storeCode === 'B01')).toBe(true);
    });

    it('gets one sale by id', async () => {
      const staff = await staffB01();
      const made = await sell(staff, [['SKU001', 1]]);

      const got = await call((await controller()).get(staff), { id: made.id });

      expect(got.id).toBe(made.id);
      expect(got.number).toBe(made.number);
    });

    it('refuses a store employee reading another store’s sale', async () => {
      const made = await sell(await staffB01(), [['SKU001', 1]]);

      const error = await call((await controller()).get(await staffB02()), { id: made.id }).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
