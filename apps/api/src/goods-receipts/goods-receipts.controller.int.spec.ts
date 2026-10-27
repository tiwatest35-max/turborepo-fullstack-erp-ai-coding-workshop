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
  });
});
