import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { PurchaseOrdersController } from '../purchase-orders/purchase-orders.controller.js';
import { DocumentNumberingService } from '../stock/document-numbering.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { AuditLogController } from './audit-log.controller.js';
import { AuditLogService } from './audit-log.service.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('AuditLogController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controllers() {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditLogController, PurchaseOrdersController],
      providers: [
        { provide: PrismaService, useValue: db.prisma },
        DocumentNumberingService,
        AuditLogService,
      ],
    }).compile();
    return {
      audit: moduleRef.get(AuditLogController),
      orders: moduleRef.get(PurchaseOrdersController),
    };
  }

  /** Two submitted orders: one approved, one rejected with a reason. */
  async function decideTwoOrders() {
    const { orders } = await controllers();
    const [supplier, store, product, buyer, manager] = await Promise.all([
      db.prisma.supplier.findUniqueOrThrow({ where: { code: 'SUP01' } }),
      db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } }),
      db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } }),
      db.userByEmail('buyer01@erp.local'),
      db.userByEmail('manager01@erp.local'),
    ]);
    const submitted = async () => {
      const draft = await call(orders.create(buyer), {
        supplierId: supplier.id,
        storeId: store.id,
        expectedReceiptDate: '2026-11-15',
        lines: [{ productId: product.id, quantity: 5, unitPrice: 45 }],
      });
      return call(orders.submit(), { id: draft.id });
    };
    const first = await submitted();
    const second = await submitted();
    await call(orders.approve(manager), { id: first.id });
    await call(orders.reject(manager), { id: second.id, reason: 'Price is above the quote' });
    return { first, second, manager };
  }

  it('lists approvals and rejections newest first with actor, time, document and outcome', async () => {
    const { first, second, manager } = await decideTwoOrders();
    const { audit } = await controllers();

    const page = await call(audit.list(), { page: 1, pageSize: 20 });

    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 2, hasMore: false });
    expect(page.items).toEqual([
      {
        id: expect.any(String),
        actorId: manager.id,
        actorName: 'Manager 01',
        sourceDocumentType: 'PURCHASE_ORDER',
        sourceDocumentNumber: second.number,
        outcome: 'REJECTED',
        reason: 'Price is above the quote',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
      expect.objectContaining({
        sourceDocumentNumber: first.number,
        outcome: 'APPROVED',
        reason: null,
      }),
    ]);
  });

  it('is empty before anything has been decided', async () => {
    const { audit } = await controllers();

    const page = await call(audit.list(), { page: 1, pageSize: 20 });

    expect(page).toMatchObject({ items: [], total: 0, hasMore: false });
  });

  it('cannot be edited or deleted, even with SQL', async () => {
    await decideTwoOrders();

    const edit = db.prisma.auditLog.updateMany({ data: { reason: 'Rewritten' } });
    const remove = db.prisma.auditLog.deleteMany();

    await expect(edit).rejects.toThrow(/append-only/);
    await expect(remove).rejects.toThrow(/append-only/);
    expect(await db.prisma.auditLog.count()).toBe(2);
  });
});
