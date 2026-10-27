import type { PrismaClient } from '@erp/database';
import { describe, expect, it } from 'vitest';
import { useIntegrationDatabase } from '../test/integration.js';
import { InsufficientStockError, StockLedgerService } from './stock-ledger.service.js';

describe('StockLedgerService (real Postgres)', () => {
  const db = useIntegrationDatabase();
  const ledger = () => new StockLedgerService();

  async function ids(prisma: PrismaClient, sku: string, storeCode: string) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
    const store = await prisma.store.findUniqueOrThrow({ where: { code: storeCode } });
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'staff_b01@erp.local' } });
    return { productId: product.id, storeId: store.id, actorId: actor.id };
  }

  const quantityOf = async (productId: string, storeId: string) =>
    (
      await db.prisma.stockBalance.findUniqueOrThrow({
        where: { productId_storeId: { productId, storeId } },
      })
    ).quantity;

  it('records a receipt: raises the balance and writes a movement with balances before and after', async () => {
    const { productId, storeId, actorId } = await ids(db.prisma, 'SKU001', 'B01');

    const movement = await db.prisma.$transaction((tx) =>
      ledger().post(tx, {
        productId,
        storeId,
        quantityChange: 8,
        movementType: 'RECEIPT',
        sourceDocumentType: 'GOODS_RECEIPT',
        sourceDocumentNumber: 'GR-000001',
        actorId,
      }),
    );

    expect(movement).toMatchObject({
      productId,
      storeId,
      productSku: 'SKU001',
      productName: 'Drinking water pack of 6',
      quantityChange: 8,
      balanceBefore: 10,
      balanceAfter: 18,
      movementType: 'RECEIPT',
      sourceDocumentType: 'GOODS_RECEIPT',
      sourceDocumentNumber: 'GR-000001',
      actorId,
    });
    expect(movement.createdAt).toBeInstanceOf(Date);
    expect(await quantityOf(productId, storeId)).toBe(18);
  });

  it('creates the balance row from zero on the first movement of a new product', async () => {
    const { storeId, actorId } = await ids(db.prisma, 'SKU002', 'B01');
    const created = await db.prisma.product.create({
      data: { sku: 'SKU-NEW', name: 'New thing', category: 'x', unit: 'pcs', sellingPrice: 1 },
    });
    const movement = await db.prisma.$transaction((tx) =>
      ledger().post(tx, {
        productId: created.id,
        storeId,
        quantityChange: 4,
        movementType: 'ADJUSTMENT',
        sourceDocumentType: 'ADJUSTMENT',
        actorId,
      }),
    );

    expect(movement).toMatchObject({
      balanceBefore: 0,
      balanceAfter: 4,
      sourceDocumentNumber: null,
    });
    expect(await quantityOf(created.id, storeId)).toBe(4);
  });

  it('rejects a decrease larger than the balance and changes nothing (INV-03)', async () => {
    const { productId, storeId, actorId } = await ids(db.prisma, 'SKU001', 'B01');
    const movementsBefore = await db.prisma.stockMovement.count();

    const error = await db.prisma
      .$transaction((tx) =>
        ledger().post(tx, {
          productId,
          storeId,
          quantityChange: -11,
          movementType: 'SALE',
          sourceDocumentType: 'SALE',
          actorId,
        }),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InsufficientStockError);
    expect(error).toMatchObject({ productId, storeId, available: 10, requested: 11 });
    expect(await quantityOf(productId, storeId)).toBe(10);
    expect(await db.prisma.stockMovement.count()).toBe(movementsBefore);
  });

  it('refuses a zero or fractional change before touching the database', async () => {
    const { productId, storeId, actorId } = await ids(db.prisma, 'SKU001', 'B01');
    const post = (quantityChange: number) =>
      db.prisma.$transaction((tx) =>
        ledger().post(tx, {
          productId,
          storeId,
          quantityChange,
          movementType: 'ADJUSTMENT',
          sourceDocumentType: 'ADJUSTMENT',
          actorId,
        }),
      );

    await expect(post(0)).rejects.toThrow(/whole number/);
    await expect(post(1.5)).rejects.toThrow(/whole number/);
    expect(await quantityOf(productId, storeId)).toBe(10);
  });

  it('rolls the stock change back together with the document that caused it (INV-03)', async () => {
    const { productId, storeId, actorId } = await ids(db.prisma, 'SKU001', 'B01');

    await db.prisma
      .$transaction(async (tx) => {
        await ledger().post(tx, {
          productId,
          storeId,
          quantityChange: 5,
          movementType: 'RECEIPT',
          sourceDocumentType: 'GOODS_RECEIPT',
          actorId,
        });
        throw new Error('the document failed after posting stock');
      })
      .catch(() => undefined);

    expect(await quantityOf(productId, storeId)).toBe(10);
    expect(
      await db.prisma.stockMovement.count({
        where: { productId, storeId, movementType: 'RECEIPT' },
      }),
    ).toBe(0);
  });

  it('keeps every balance equal to the sum of its movements', async () => {
    const { productId, storeId, actorId } = await ids(db.prisma, 'SKU001', 'B01');
    const post = (quantityChange: number) =>
      db.prisma.$transaction((tx) =>
        ledger().post(tx, {
          productId,
          storeId,
          quantityChange,
          movementType: quantityChange > 0 ? 'RECEIPT' : 'SALE',
          sourceDocumentType: 'TEST',
          actorId,
        }),
      );

    await post(8);
    await post(-3);
    await post(-15);
    await post(1).catch(() => undefined);

    const balances = await db.prisma.stockBalance.findMany();
    expect(balances.length).toBeGreaterThan(0);
    for (const balance of balances) {
      const { _sum } = await db.prisma.stockMovement.aggregate({
        where: { productId: balance.productId, storeId: balance.storeId },
        _sum: { quantityChange: true },
      });
      expect(balance.quantity).toBe(_sum.quantityChange ?? 0);
    }
  });

  it('does not lose updates when two sales of 7 race for a stock of 10 (INV-04)', async () => {
    const { productId, storeId, actorId } = await ids(db.prisma, 'SKU001', 'B01');
    const sell = () =>
      db.prisma.$transaction((tx) =>
        ledger().post(tx, {
          productId,
          storeId,
          quantityChange: -7,
          movementType: 'SALE',
          sourceDocumentType: 'SALE',
          actorId,
        }),
      );

    const results = await Promise.allSettled([sell(), sell()]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      InsufficientStockError,
    );
    expect(await quantityOf(productId, storeId)).toBe(3);
  });

  describe('the database itself', () => {
    it('refuses a negative balance written around the service (INV-03)', async () => {
      const { productId, storeId } = await ids(db.prisma, 'SKU001', 'B01');

      await expect(
        db.prisma.stockBalance.update({
          where: { productId_storeId: { productId, storeId } },
          data: { quantity: -1 },
        }),
      ).rejects.toThrow();
      expect(await quantityOf(productId, storeId)).toBe(10);
    });

    it('refuses to edit or delete a confirmed movement (INV-02)', async () => {
      const opening = await db.prisma.stockMovement.findFirstOrThrow({
        where: { movementType: 'OPENING' },
      });

      await expect(
        db.prisma.stockMovement.update({ where: { id: opening.id }, data: { quantityChange: 99 } }),
      ).rejects.toThrow(/append-only/);
      await expect(db.prisma.stockMovement.delete({ where: { id: opening.id } })).rejects.toThrow(
        /append-only/,
      );
      await expect(db.prisma.stockMovement.deleteMany()).rejects.toThrow(/append-only/);

      const after = await db.prisma.stockMovement.findUniqueOrThrow({ where: { id: opening.id } });
      expect(after).toEqual(opening);
    });
  });
});
