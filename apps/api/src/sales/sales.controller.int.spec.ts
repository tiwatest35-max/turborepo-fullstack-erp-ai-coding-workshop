import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import type { User } from '@erp/contracts';
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
  });
});
