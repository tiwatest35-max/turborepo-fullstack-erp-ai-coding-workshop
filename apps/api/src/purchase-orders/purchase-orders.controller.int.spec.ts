import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { PurchaseOrdersController } from './purchase-orders.controller.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('PurchaseOrdersController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controller() {
    const moduleRef = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [{ provide: PrismaService, useValue: db.prisma }, DocumentNumberingService],
    }).compile();
    return moduleRef.get(PurchaseOrdersController);
  }

  /** The ids a draft needs, from the TOR 8.1 data. */
  async function ids() {
    const [supplier, b01, b02, sku001, sku002] = await Promise.all([
      db.prisma.supplier.findUniqueOrThrow({ where: { code: 'SUP01' } }),
      db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } }),
      db.prisma.store.findUniqueOrThrow({ where: { code: 'B02' } }),
      db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } }),
      db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU002' } }),
    ]);
    return { supplier, b01, b02, sku001, sku002 };
  }

  /** A valid draft: 20 packs of SKU001 at 45.00. */
  async function validInput() {
    const { supplier, b01, sku001 } = await ids();
    return {
      supplierId: supplier.id,
      storeId: b01.id,
      expectedReceiptDate: '2026-11-15',
      lines: [{ productId: sku001.id, quantity: 20, unitPrice: 45 }],
    };
  }

  const buyer = () => db.userByEmail('buyer01@erp.local');

  const create = async (input: Awaited<ReturnType<typeof validInput>>) =>
    call((await controller()).create(await buyer()), input);
  const update = async (id: string, input: Awaited<ReturnType<typeof validInput>>) =>
    call((await controller()).update(), { id, ...input });
  const submit = async (id: string) => call((await controller()).submit(), { id });
  const get = async (id: string) => call((await controller()).get(), { id });
  const list = async (input = {}) =>
    call((await controller()).list(), { page: 1, pageSize: 20, ...input });

  /** Every stock balance and movement, to prove a purchase order never touches stock (PO-02). */
  async function stockState() {
    const [balances, movements] = await Promise.all([
      db.prisma.stockBalance.findMany({ orderBy: [{ productId: 'asc' }, { storeId: 'asc' }] }),
      db.prisma.stockMovement.count(),
    ]);
    return { balances: balances.map((b) => [b.productId, b.storeId, b.quantity]), movements };
  }

  async function orderCount() {
    return db.prisma.purchaseOrder.count();
  }

  describe('create', () => {
    it('saves a draft with supplier, store, date and a line, and totals it', async () => {
      const input = await validInput();

      const order = await create(input);

      expect(order).toMatchObject({
        number: 'PO-000001',
        status: 'DRAFT',
        supplierCode: 'SUP01',
        supplierName: 'SupplyOne Co Ltd',
        storeCode: 'B01',
        expectedReceiptDate: '2026-11-15',
        createdByName: 'Buyer 01',
        submittedAt: null,
        totalAmount: 900,
      });
      expect(order.lines).toEqual([
        expect.objectContaining({
          sku: 'SKU001',
          productName: 'Drinking water pack of 6',
          unit: 'pack',
          quantity: 20,
          unitPrice: 45,
          lineAmount: 900,
        }),
      ]);
      expect(await get(order.id)).toEqual(order);
    });

    it('calculates each line as quantity times price and sums them to two decimals', async () => {
      const { supplier, b01, sku001, sku002 } = await ids();

      const order = await create({
        supplierId: supplier.id,
        storeId: b01.id,
        expectedReceiptDate: '2026-11-15',
        lines: [
          { productId: sku001.id, quantity: 3, unitPrice: 12.34 },
          { productId: sku002.id, quantity: 7, unitPrice: 0.1 },
        ],
      });

      expect(order.lines.map((line) => line.lineAmount)).toEqual([37.02, 0.7]);
      expect(order.totalAmount).toBe(37.72);
    });

    it('numbers each document differently', async () => {
      const first = await create(await validInput());
      const second = await create(await validInput());

      expect([first.number, second.number]).toEqual(['PO-000001', 'PO-000002']);
    });

    it('does not change any stock balance or movement (PO-02)', async () => {
      const before = await stockState();

      await create(await validInput());

      expect(await stockState()).toEqual(before);
    });

    it('rejects a duplicate SKU within one order and saves nothing', async () => {
      const input = await validInput();
      const line = input.lines[0]!;

      const error = await create({
        ...input,
        lines: [line, { ...line, quantity: 1 }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(await orderCount()).toBe(0);
    });

    it.each([0, -1, 1.5])('rejects an ordered quantity of %s', async (quantity) => {
      const input = await validInput();

      const error = await create({
        ...input,
        lines: [{ ...input.lines[0]!, quantity }],
      }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(await orderCount()).toBe(0);
    });

    it('rejects a negative purchase price but accepts a price of zero', async () => {
      const input = await validInput();
      const withPrice = (unitPrice: number) => ({
        ...input,
        lines: [{ ...input.lines[0]!, unitPrice }],
      });

      const rejected = await create(withPrice(-0.01)).catch((e: unknown) => e);
      const free = await create(withPrice(0));

      expect(rejected).toMatchObject({ code: 'BAD_REQUEST' });
      expect(free.totalAmount).toBe(0);
      expect(await orderCount()).toBe(1);
    });

    it('rejects an order with no lines', async () => {
      const input = await validInput();

      const error = await create({ ...input, lines: [] }).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(await orderCount()).toBe(0);
    });

    it('rejects an inactive product, names its SKU, and saves nothing (MD-02)', async () => {
      const input = await validInput();
      await db.prisma.product.update({ where: { sku: 'SKU001' }, data: { active: false } });

      const error = await create(input).catch((e: unknown) => e);

      expect(error).toMatchObject({
        code: 'BAD_REQUEST',
        data: {
          code: 'PO_PRODUCT_INACTIVE',
          messageTh: expect.stringContaining('SKU001'),
          action: 'correct_input',
        },
      });
      expect(await orderCount()).toBe(0);
    });

    it('does not use up a document number when the order is rejected', async () => {
      const input = await validInput();
      await db.prisma.product.update({ where: { sku: 'SKU001' }, data: { active: false } });
      await create(input).catch(() => undefined);
      await db.prisma.product.update({ where: { sku: 'SKU001' }, data: { active: true } });

      const order = await create(input);

      expect(order.number).toBe('PO-000001');
    });

    it.each([
      ['supplier', 'PO_SUPPLIER_UNKNOWN'],
      ['store', 'PO_STORE_UNKNOWN'],
      ['product', 'PO_PRODUCT_UNKNOWN'],
    ] as const)('rejects an unknown %s', async (what, code) => {
      const input = await validInput();
      const bad =
        what === 'supplier'
          ? { ...input, supplierId: 'missing' }
          : what === 'store'
            ? { ...input, storeId: 'missing' }
            : { ...input, lines: [{ ...input.lines[0]!, productId: 'missing' }] };

      const error = await create(bad).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'BAD_REQUEST', data: { code, action: 'correct_input' } });
      expect(await orderCount()).toBe(0);
    });

    it('keeps the line as it was saved when the product is edited later (TOR 4.3)', async () => {
      const order = await create(await validInput());

      await db.prisma.product.update({
        where: { sku: 'SKU001' },
        data: { name: 'Renamed water', unit: 'box', sellingPrice: 99, active: false },
      });

      const line = (await get(order.id)).lines[0]!;
      expect(line).toMatchObject({
        sku: 'SKU001',
        productName: 'Drinking water pack of 6',
        unit: 'pack',
        unitPrice: 45,
      });
    });
  });

  describe('update', () => {
    it('replaces the contents of a draft and keeps its number', async () => {
      const { b02, sku002 } = await ids();
      const input = await validInput();
      const order = await create(input);

      const updated = await update(order.id, {
        ...input,
        storeId: b02.id,
        expectedReceiptDate: '2026-12-01',
        lines: [{ productId: sku002.id, quantity: 4, unitPrice: 20 }],
      });

      expect(updated).toMatchObject({
        id: order.id,
        number: order.number,
        status: 'DRAFT',
        storeCode: 'B02',
        expectedReceiptDate: '2026-12-01',
        totalAmount: 80,
      });
      expect(updated.lines.map((line) => [line.sku, line.quantity])).toEqual([['SKU002', 4]]);
      expect(await get(order.id)).toEqual(updated);
    });

    it('applies the same rules as create and leaves the draft as it was', async () => {
      const input = await validInput();
      const order = await create(input);
      const line = input.lines[0]!;

      const duplicate = await update(order.id, { ...input, lines: [line, line] }).catch(
        (e: unknown) => e,
      );
      await db.prisma.product.update({ where: { sku: 'SKU002' }, data: { active: false } });
      const { sku002 } = await ids();
      const inactive = await update(order.id, {
        ...input,
        lines: [{ productId: sku002.id, quantity: 1, unitPrice: 1 }],
      }).catch((e: unknown) => e);

      expect(duplicate).toMatchObject({ code: 'BAD_REQUEST' });
      expect(inactive).toMatchObject({
        code: 'BAD_REQUEST',
        data: { code: 'PO_PRODUCT_INACTIVE' },
      });
      expect(await get(order.id)).toEqual(order);
    });

    it('refuses to edit an order that is no longer a draft', async () => {
      const input = await validInput();
      const order = await create(input);
      await submit(order.id);

      const error = await update(order.id, { ...input, expectedReceiptDate: '2027-01-01' }).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({
        code: 'CONFLICT',
        data: { code: 'PO_NOT_DRAFT', action: 'correct_input' },
      });
      expect((await get(order.id)).expectedReceiptDate).toBe('2026-11-15');
    });

    it('answers NOT_FOUND for an order that does not exist', async () => {
      const error = await update('missing', await validInput()).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'NOT_FOUND', data: { code: 'PO_NOT_FOUND' } });
    });
  });

  describe('submit', () => {
    it('moves a complete draft to Pending Approval without changing stock (PO-02, PO-03)', async () => {
      const order = await create(await validInput());
      const before = await stockState();

      const submitted = await submit(order.id);

      expect(submitted).toMatchObject({ id: order.id, status: 'PENDING_APPROVAL' });
      expect(new Date(submitted.submittedAt!).getTime()).not.toBeNaN();
      expect(submitted.lines).toEqual(order.lines);
      expect(await stockState()).toEqual(before);
    });

    it('carries the line snapshot through submission, whatever happens to the product', async () => {
      const order = await create(await validInput());
      await db.prisma.product.update({ where: { sku: 'SKU001' }, data: { name: 'Renamed water' } });

      const submitted = await submit(order.id);

      expect(submitted.lines[0]).toMatchObject({
        sku: 'SKU001',
        productName: 'Drinking water pack of 6',
        unit: 'pack',
        unitPrice: 45,
      });
    });

    it('refuses to submit twice', async () => {
      const order = await create(await validInput());
      await submit(order.id);

      const error = await submit(order.id).catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'CONFLICT', data: { code: 'PO_NOT_DRAFT' } });
    });

    it('answers NOT_FOUND for an order that does not exist', async () => {
      const error = await submit('missing').catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 'NOT_FOUND', data: { code: 'PO_NOT_FOUND' } });
    });
  });

  describe('list', () => {
    it('lists newest first in the shared envelope and filters by status', async () => {
      const first = await create(await validInput());
      const second = await create(await validInput());
      await submit(first.id);

      const all = await list();
      const pending = await list({ status: 'PENDING_APPROVAL' });
      const drafts = await list({ status: 'DRAFT' });

      expect(all.items.map((order) => order.number)).toEqual([second.number, first.number]);
      expect(all).toMatchObject({ page: 1, pageSize: 20, total: 2, hasMore: false });
      expect(pending.items.map((order) => order.number)).toEqual([first.number]);
      expect(drafts.items.map((order) => order.number)).toEqual([second.number]);
    });
  });
});
