import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import type { User } from '@erp/contracts';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';
import { StockLedgerService } from '../stock/stock-ledger.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { GoodsReceiptsController } from './goods-receipts.controller.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('GoodsReceiptsController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controller() {
    const moduleRef = await Test.createTestingModule({
      controllers: [GoodsReceiptsController],
      providers: [
        { provide: PrismaService, useValue: db.prisma },
        DocumentNumberingService,
        StockLedgerService,
      ],
    }).compile();
    return moduleRef.get(GoodsReceiptsController);
  }

  const staffB01 = () => db.userByEmail('staff_b01@erp.local');
  const staffB02 = () => db.userByEmail('staff_b02@erp.local');

  /**
   * TOR 8.1: PO-DEMO-001 is Approved for B01 and holds 20 packs of SKU001 at 45.00,
   * with no previous receipts. Returns the order and its one line.
   */
  async function demoOrder(status: 'APPROVED' | 'PARTIALLY_RECEIVED' = 'APPROVED') {
    const [supplier, b01, buyer, manager, sku001] = await Promise.all([
      db.prisma.supplier.findUniqueOrThrow({ where: { code: 'SUP01' } }),
      db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } }),
      db.userByEmail('buyer01@erp.local'),
      db.userByEmail('manager01@erp.local'),
      db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } }),
    ]);
    const order = await db.prisma.purchaseOrder.create({
      data: {
        number: 'PO-DEMO-001',
        status,
        supplierId: supplier.id,
        storeId: b01.id,
        expectedReceiptDate: new Date('2026-11-15T00:00:00.000Z'),
        createdById: buyer.id,
        submittedAt: new Date(),
        decidedById: manager.id,
        decidedAt: new Date(),
        lines: {
          create: {
            productId: sku001.id,
            sku: sku001.sku,
            productName: sku001.name,
            unit: sku001.unit,
            quantity: 20,
            unitPrice: 45,
          },
        },
      },
      include: { lines: true },
    });
    return { order, line: order.lines[0]! };
  }

  let keyCounter = 0;
  const newKey = () => `test-key-${++keyCounter}-${Math.random().toString(36).slice(2)}`;

  const receive = async (
    user: User,
    input: {
      purchaseOrderId: string;
      lines: { purchaseOrderLineId: string; quantity: number }[];
      idempotencyKey?: string;
    },
  ) => call((await controller()).confirm(user), { idempotencyKey: newKey(), ...input });

  const b01Stock = async (sku = 'SKU001') =>
    (
      await db.prisma.stockBalance.findFirstOrThrow({
        where: { product: { sku }, store: { code: 'B01' } },
      })
    ).quantity;
  const receiptCount = () => db.prisma.goodsReceipt.count();
  const receiptMovements = () =>
    db.prisma.stockMovement.findMany({ where: { movementType: 'RECEIPT' } });
  const statusOf = async (id: string) =>
    (await db.prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;

  describe('confirm', () => {
    it('AC-01: staff_b01 receives 8 of SKU001 against PO-DEMO-001', async () => {
      const { order, line } = await demoOrder();

      const receipt = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      expect(receipt).toMatchObject({
        number: 'GR-000001',
        purchaseOrderNumber: 'PO-DEMO-001',
        storeCode: 'B01',
        receivedByName: 'Staff B01',
      });
      expect(receipt.lines).toEqual([
        expect.objectContaining({ sku: 'SKU001', unit: 'pack', quantity: 8 }),
      ]);
      expect(await b01Stock()).toBe(18);
      expect(await statusOf(order.id)).toBe('PARTIALLY_RECEIVED');
      expect(
        (await db.prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } }))
          .receivedQuantity,
      ).toBe(8);
      expect(await receiptCount()).toBe(1);
      expect(await receiptMovements()).toEqual([
        expect.objectContaining({
          quantityChange: 8,
          balanceBefore: 10,
          balanceAfter: 18,
          sourceDocumentType: 'GOODS_RECEIPT',
          sourceDocumentNumber: 'GR-000001',
        }),
      ]);
    });

    it('AC-03: receiving 21 of 20 is rejected and nothing changes', async () => {
      const { order, line } = await demoOrder();

      const error = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 21 }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'BAD_REQUEST',
        data: { code: 'GR_EXCEEDS_ORDERED', action: 'correct_input' },
      });
      expect(await receiptCount()).toBe(0);
      expect(await receiptMovements()).toEqual([]);
      expect(await b01Stock()).toBe(10);
      expect(await statusOf(order.id)).toBe('APPROVED');
    });

    it('caps the cumulative total across deliveries, not each delivery', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      const error = await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 13 }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST', data: { code: 'GR_EXCEEDS_ORDERED' } });
      expect(error).toMatchObject({ data: { messageTh: expect.stringContaining('SKU001') } });
      expect(await receiptCount()).toBe(1);
      expect(await b01Stock()).toBe(18);
    });

    it('completes the order when the rest arrives, and stock follows (business example)', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      const second = await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 12 }],
      });

      expect(second.number).toBe('GR-000002');
      expect(await b01Stock()).toBe(30);
      expect(await statusOf(order.id)).toBe('COMPLETED');
      expect(await receiptMovements()).toHaveLength(2);
    });

    it("AC-04: staff_b02 cannot receive for B01's order, and no business data changes", async () => {
      const { order, line } = await demoOrder();

      const error = await receive(await staffB02(), {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'FORBIDDEN',
        data: { code: 'GR_STORE_FORBIDDEN', action: 'correct_input' },
      });
      expect(await receiptCount()).toBe(0);
      expect(await receiptMovements()).toEqual([]);
      expect(await b01Stock()).toBe(10);
      expect(await statusOf(order.id)).toBe('APPROVED');
      expect((await db.prisma.documentSequence.findMany()).map((s) => s.prefix)).not.toContain(
        'GR',
      );
    });

    it('answers NOT_FOUND for an order that does not exist', async () => {
      const error = await receive(await staffB01(), {
        purchaseOrderId: 'missing',
        lines: [{ purchaseOrderLineId: 'whatever', quantity: 1 }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'NOT_FOUND', data: { code: 'GR_ORDER_NOT_FOUND' } });
    });

    it.each(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const)(
      'refuses an order that is %s (GR-01)',
      async (status) => {
        const { order, line } = await demoOrder();
        await db.prisma.purchaseOrder.update({ where: { id: order.id }, data: { status } });

        const error = await receive(await staffB01(), {
          purchaseOrderId: order.id,
          lines: [{ purchaseOrderLineId: line.id, quantity: 1 }],
        }).catch((e: unknown) => e);

        expect(error).toMatchObject({
          code: 'CONFLICT',
          data: { code: 'GR_ORDER_NOT_RECEIVABLE', action: 'correct_input' },
        });
        expect(await receiptCount()).toBe(0);
        expect(await b01Stock()).toBe(10);
        expect(await statusOf(order.id)).toBe(status);
      },
    );

    it('refuses a product that is not on the order and receives nothing', async () => {
      const { order, line } = await demoOrder();
      const sku002 = await db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU002' } });
      const otherOrder = await db.prisma.purchaseOrder.create({
        data: {
          number: 'PO-OTHER',
          status: 'APPROVED',
          supplierId: order.supplierId,
          storeId: order.storeId,
          expectedReceiptDate: order.expectedReceiptDate,
          createdById: order.createdById,
          lines: {
            create: {
              productId: sku002.id,
              sku: sku002.sku,
              productName: sku002.name,
              unit: sku002.unit,
              quantity: 5,
              unitPrice: 20,
            },
          },
        },
        include: { lines: true },
      });

      const error = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [
          { purchaseOrderLineId: line.id, quantity: 1 },
          { purchaseOrderLineId: otherOrder.lines[0]!.id, quantity: 5 },
        ],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST', data: { code: 'GR_LINE_NOT_ON_ORDER' } });
      expect(await receiptCount()).toBe(0);
      expect(await b01Stock()).toBe(10);
      expect(await b01Stock('SKU002')).toBe(5);
    });

    it.each([
      ['a negative quantity', [{ quantity: -1 }]],
      ['a fractional quantity', [{ quantity: 1.5 }]],
      ['only zero quantities', [{ quantity: 0 }]],
      ['no lines', []],
    ])('rejects %s', async (_name, lines) => {
      const { order, line } = await demoOrder();

      const error = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: lines.map(({ quantity }) => ({ purchaseOrderLineId: line.id, quantity })),
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(await receiptCount()).toBe(0);
      expect(await b01Stock()).toBe(10);
    });

    it('rejects the same line twice in one receipt', async () => {
      const { order, line } = await demoOrder();

      const error = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [
          { purchaseOrderLineId: line.id, quantity: 5 },
          { purchaseOrderLineId: line.id, quantity: 5 },
        ],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(await receiptCount()).toBe(0);
    });

    it('takes no date from the client: the system confirmation time is used (Q-03)', async () => {
      const { order, line } = await demoOrder();
      const backdated = {
        idempotencyKey: newKey(),
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
        receivedAt: '2020-01-01T00:00:00.000Z',
      };
      const before = Date.now();

      const refused = await call((await controller()).confirm(await staffB01()), backdated).catch(
        (e: unknown) => e,
      );
      const receipt = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      expect(refused).toMatchObject({ code: 'BAD_REQUEST' });
      expect(await receiptCount()).toBe(1);
      expect(new Date(receipt.receivedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(new Date(receipt.receivedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('skips zero-quantity lines: no receipt line, no movement for them', async () => {
      const { order, line } = await demoOrder();
      const sku002 = await db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU002' } });
      const second = await db.prisma.purchaseOrderLine.create({
        data: {
          purchaseOrderId: order.id,
          productId: sku002.id,
          sku: sku002.sku,
          productName: sku002.name,
          unit: sku002.unit,
          quantity: 5,
          unitPrice: 20,
        },
      });

      const receipt = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [
          { purchaseOrderLineId: line.id, quantity: 0 },
          { purchaseOrderLineId: second.id, quantity: 5 },
        ],
      });

      expect(receipt.lines.map((l) => [l.sku, l.quantity])).toEqual([['SKU002', 5]]);
      expect(await receiptMovements()).toHaveLength(1);
      expect(await b01Stock()).toBe(10);
      expect(await b01Stock('SKU002')).toBe(10);
      // SKU001 still has all 20 outstanding, so the order is not complete.
      expect(await statusOf(order.id)).toBe('PARTIALLY_RECEIVED');
    });

    it('still receives a product deactivated after approval, against its approved line (Q-02)', async () => {
      const { order, line } = await demoOrder();
      await db.prisma.product.update({ where: { sku: 'SKU001' }, data: { active: false } });

      const receipt = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      expect(receipt.lines[0]).toMatchObject({ sku: 'SKU001', quantity: 8 });
      expect(await b01Stock()).toBe(18);
      expect(await statusOf(order.id)).toBe('PARTIALLY_RECEIVED');
    });

    it('leaves the order Partially Received after a further partial delivery', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 5 }],
      });

      expect(await b01Stock()).toBe(23);
      expect(await statusOf(order.id)).toBe('PARTIALLY_RECEIVED');
    });

    it('AC-02: repeating the same idempotencyKey returns the first receipt and does not receive twice', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const key = newKey();
      const body = {
        purchaseOrderId: order.id,
        idempotencyKey: key,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      };

      const first = await call((await controller()).confirm(staff), body);
      const replay = await call((await controller()).confirm(staff), body);

      expect(replay.id).toBe(first.id);
      expect(replay.number).toBe(first.number);
      expect(await receiptCount()).toBe(1);
      expect(await b01Stock()).toBe(18);
      expect(await receiptMovements()).toHaveLength(1);
    });

    it('a deliberately new key against the same order makes a second receipt', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();

      const first = await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });
      const second = await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 5 }],
      });

      expect(second.id).not.toBe(first.id);
      expect(await receiptCount()).toBe(2);
      expect(await b01Stock()).toBe(23);
    });

    it('replays the receipt that completed the order, even though its status is now COMPLETED', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const key = newKey();
      const body = {
        purchaseOrderId: order.id,
        idempotencyKey: key,
        lines: [{ purchaseOrderLineId: line.id, quantity: 20 }],
      };

      const first = await call((await controller()).confirm(staff), body);
      expect(await statusOf(order.id)).toBe('COMPLETED');

      // The lost-response case: the order is COMPLETED now, but the same key must replay,
      // not be refused as not-receivable.
      const replay = await call((await controller()).confirm(staff), body);

      expect(replay.id).toBe(first.id);
      expect(await receiptCount()).toBe(1);
      expect(await b01Stock()).toBe(30);
    });

    it('rejects the same key reused for a different request', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const key = newKey();
      await call((await controller()).confirm(staff), {
        purchaseOrderId: order.id,
        idempotencyKey: key,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      const error = await call((await controller()).confirm(staff), {
        purchaseOrderId: order.id,
        idempotencyKey: key,
        lines: [{ purchaseOrderLineId: line.id, quantity: 5 }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONFLICT', data: { code: 'GR_IDEMPOTENCY_REUSED' } });
      // Only the first receipt exists; the mismatched replay changed nothing.
      expect(await receiptCount()).toBe(1);
      expect(await b01Stock()).toBe(18);
    });
  });

  /** Seam 2: concurrent confirms through the same handler path, against a real Postgres (GR-04, GR-05). */
  describe('confirm under concurrency', () => {
    const settle = (calls: Promise<unknown>[]) => Promise.allSettled(calls);

    it('GR-05: two concurrent receipts of 12 against an order of 20 -> exactly one succeeds, received stays 12', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const body = () => ({
        purchaseOrderId: order.id,
        idempotencyKey: newKey(),
        lines: [{ purchaseOrderLineId: line.id, quantity: 12 }],
      });

      const results = await settle([
        call((await controller()).confirm(staff), body()),
        call((await controller()).confirm(staff), body()),
      ]);

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: 'BAD_REQUEST',
        data: { code: 'GR_EXCEEDS_ORDERED', action: 'correct_input' },
      });
      expect(
        (await db.prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } }))
          .receivedQuantity,
      ).toBe(12);
      expect(await receiptCount()).toBe(1);
      expect(await receiptMovements()).toHaveLength(1);
      expect(await b01Stock()).toBe(22);
      expect(await statusOf(order.id)).toBe('PARTIALLY_RECEIVED');
    });

    it('concurrent receipts that fit together both succeed and the cumulative total is exact', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const body = () => ({
        purchaseOrderId: order.id,
        idempotencyKey: newKey(),
        lines: [{ purchaseOrderLineId: line.id, quantity: 10 }],
      });

      const results = await settle([
        call((await controller()).confirm(staff), body()),
        call((await controller()).confirm(staff), body()),
      ]);

      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await receiptCount()).toBe(2);
      expect(await b01Stock()).toBe(30);
      expect(await statusOf(order.id)).toBe('COMPLETED');
      const numbers = (await db.prisma.goodsReceipt.findMany()).map((r) => r.number).sort();
      expect(numbers).toEqual(['GR-000001', 'GR-000002']);
    });

    it('GR-04: the same request fired twice at once creates one receipt and both calls get it', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const body = {
        purchaseOrderId: order.id,
        idempotencyKey: newKey(),
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      };

      const [a, b] = await Promise.all([
        call((await controller()).confirm(staff), body),
        call((await controller()).confirm(staff), body),
      ]);

      expect(a.id).toBe(b.id);
      expect(await receiptCount()).toBe(1);
      expect(await receiptMovements()).toHaveLength(1);
      expect(await b01Stock()).toBe(18);
      expect(
        (await db.prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: line.id } }))
          .receivedQuantity,
      ).toBe(8);
    });

    it('a rejected over-receipt leaves its idempotency key unused, so a corrected retry with the same key succeeds', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const key = newKey();
      const tooMany = await call((await controller()).confirm(staff), {
        purchaseOrderId: order.id,
        idempotencyKey: key,
        lines: [{ purchaseOrderLineId: line.id, quantity: 21 }],
      }).catch((e: unknown) => e);
      expect(tooMany).toMatchObject({ data: { code: 'GR_EXCEEDS_ORDERED' } });

      // The failed attempt rolled back with its key: it is not remembered as "used".
      const corrected = await call((await controller()).confirm(staff), {
        purchaseOrderId: order.id,
        idempotencyKey: key,
        lines: [{ purchaseOrderLineId: line.id, quantity: 20 }],
      });

      expect(corrected.number).toBe('GR-000001');
      expect(await b01Stock()).toBe(30);
    });
  });

  describe('receivable', () => {
    const listReceivable = async (user: User) =>
      call((await controller()).receivable(user), { page: 1, pageSize: 20 });

    it("lists the employee's own Approved and Partially Received orders with outstanding quantities", async () => {
      const { order } = await demoOrder();

      const result = await listReceivable(await staffB01());

      const found = result.items.find((o) => o.id === order.id);
      expect(found).toBeTruthy();
      expect(found!.lines[0]).toMatchObject({
        sku: 'SKU001',
        ordered: 20,
        received: 0,
        outstanding: 20,
      });
    });

    it('excludes orders for other stores', async () => {
      const { order } = await demoOrder();

      const result = await listReceivable(await staffB02());

      expect(result.items.find((o) => o.id === order.id)).toBeUndefined();
    });

    it('excludes orders that are not receivable (e.g. DRAFT)', async () => {
      const { order } = await demoOrder();
      await db.prisma.purchaseOrder.update({ where: { id: order.id }, data: { status: 'DRAFT' } });

      const result = await listReceivable(await staffB01());

      expect(result.items.find((o) => o.id === order.id)).toBeUndefined();
    });

    it('refuses a store employee who has no assigned store, rather than showing all stores', async () => {
      await demoOrder();
      const unbound: User = {
        id: 'nostore',
        email: 'nostore@erp.local',
        name: 'No Store',
        role: 'STORE_EMPLOYEE',
        storeId: null,
      };

      const error = await listReceivable(unbound).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('list and get', () => {
    it('lists receipts newest-first, scoped to the store employee’s store', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      const result = await call((await controller()).list(staff), { page: 1, pageSize: 20 });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.items.every((r) => r.storeCode === 'B01')).toBe(true);
    });

    it('gets one receipt by id', async () => {
      const { order, line } = await demoOrder();
      const staff = await staffB01();
      const made = await receive(staff, {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      const got = await call((await controller()).get(staff), { id: made.id });

      expect(got.id).toBe(made.id);
      expect(got.number).toBe(made.number);
    });

    it('refuses a store employee reading another store’s receipt', async () => {
      const { order, line } = await demoOrder();
      const made = await receive(await staffB01(), {
        purchaseOrderId: order.id,
        lines: [{ purchaseOrderLineId: line.id, quantity: 8 }],
      });

      const error = await call((await controller()).get(await staffB02()), { id: made.id }).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
