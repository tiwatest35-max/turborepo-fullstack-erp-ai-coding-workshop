import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { PrismaService } from '../database/prisma.service.js';
import { useIntegrationDatabase } from '../test/integration.js';
import { ProductsController } from './products.controller.js';

/** Seam 1: the oRPC contract boundary, against a real Postgres loaded with the TOR 8.1 data. */
describe('ProductsController (real Postgres)', () => {
  const db = useIntegrationDatabase();

  async function controller() {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: PrismaService, useValue: db.prisma }],
    }).compile();
    return moduleRef.get(ProductsController);
  }

  const update = async (input: { id: string } & Record<string, unknown>) =>
    call((await controller()).update(), input);

  /** Puts SKU001 on a draft purchase order, the way the purchasing ticket does it. */
  async function orderSku001() {
    const [supplier, store, product, buyer] = await Promise.all([
      db.prisma.supplier.findUniqueOrThrow({ where: { code: 'SUP01' } }),
      db.prisma.store.findUniqueOrThrow({ where: { code: 'B01' } }),
      db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU001' } }),
      db.userByEmail('buyer01@erp.local'),
    ]);
    await db.prisma.purchaseOrder.create({
      data: {
        number: 'PO-000001',
        supplierId: supplier.id,
        storeId: store.id,
        expectedReceiptDate: new Date('2026-11-15T00:00:00.000Z'),
        createdById: buyer.id,
        lines: {
          create: [
            {
              productId: product.id,
              sku: product.sku,
              productName: product.name,
              unit: product.unit,
              quantity: 20,
              unitPrice: 45,
            },
          ],
        },
      },
    });
    return product;
  }

  describe('SKU after a purchase order line references the product (MD-01)', () => {
    it('refuses to change the SKU and leaves the product as it was', async () => {
      const product = await orderSku001();

      const error = await update({ id: product.id, sku: 'SKU001-NEW', name: 'Renamed' }).catch(
        (e: unknown) => e,
      );

      expect(error).toMatchObject({
        code: 'CONFLICT',
        data: {
          code: 'PRODUCT_SKU_LOCKED',
          messageTh: expect.stringContaining('SKU001'),
          action: 'correct_input',
        },
      });
      expect(
        await db.prisma.product.findUniqueOrThrow({ where: { id: product.id } }),
      ).toMatchObject({ sku: 'SKU001', name: 'Drinking water pack of 6' });
    });

    it('still lets every other field change, and accepts the unchanged SKU being sent back', async () => {
      const product = await orderSku001();

      const result = await update({
        id: product.id,
        sku: 'SKU001',
        name: 'Renamed water',
        sellingPrice: 65,
        active: false,
      });

      expect(result).toMatchObject({
        sku: 'SKU001',
        name: 'Renamed water',
        sellingPrice: 65,
        active: false,
      });
    });

    it('lets a product no order references change its SKU', async () => {
      await orderSku001();
      const sku002 = await db.prisma.product.findUniqueOrThrow({ where: { sku: 'SKU002' } });

      const result = await update({ id: sku002.id, sku: 'SKU002-NEW' });

      expect(result.sku).toBe('SKU002-NEW');
    });
  });
});
