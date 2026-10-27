import { Role, StockMovementType } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { hashPassword } from './password.js';

/**
 * The starting data from TOR Section 8.1, shared by the dev seed and the integration tests.
 *
 * Everything is an upsert or a "create if missing", so loading it twice is harmless and never
 * overwrites stock that real work has changed. (The 8.1 purchase order PO-DEMO-001 is not here
 * yet: there is no purchase order table until the purchasing ticket adds one.)
 */

export const DEMO_PASSWORD = 'password';

// Stores double as stock locations (TOR Section 8.1). Re-running the seed resets them.
const stores = [
  { code: 'B01', name: 'Central Store' },
  { code: 'B02', name: 'Riverside Store' },
];

// Supplier from TOR Section 8.1.
const suppliers = [
  {
    code: 'SUP01',
    name: 'SupplyOne Co Ltd',
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  },
];

// Products from TOR Section 8.1. Every product has a reorder threshold of 3 in every store.
// The TOR lists no categories, so these are placeholders.
const products = [
  {
    sku: 'SKU001',
    name: 'Drinking water pack of 6',
    category: 'Beverages',
    unit: 'pack',
    sellingPrice: 60,
  },
  { sku: 'SKU002', name: 'Tissue paper', category: 'Household', unit: 'pack', sellingPrice: 35 },
  {
    sku: 'SKU003',
    name: 'Laundry detergent',
    category: 'Household',
    unit: 'bag',
    sellingPrice: 120,
  },
];
const SEED_REORDER_THRESHOLD = 3;

// Opening stock from TOR Section 8.1: B01 holds 10, 5 and 0. All B02 balances are zero.
const openingStock: Record<string, Record<string, number>> = {
  B01: { SKU001: 10, SKU002: 5, SKU003: 0 },
};

// Test users from TOR Section 8.1, with the roles from Section 2. Store employees
// are bound to one store; ADMIN and MANAGER are not store-bound.
const demoUsers = [
  { email: 'admin@erp.local', name: 'Admin User', role: Role.ADMIN, storeCode: null },
  { email: 'buyer01@erp.local', name: 'Buyer 01', role: Role.PURCHASING, storeCode: null },
  { email: 'manager01@erp.local', name: 'Manager 01', role: Role.MANAGER, storeCode: null },
  { email: 'staff_b01@erp.local', name: 'Staff B01', role: Role.STORE_EMPLOYEE, storeCode: 'B01' },
  { email: 'staff_b02@erp.local', name: 'Staff B02', role: Role.STORE_EMPLOYEE, storeCode: 'B02' },
];
/** The user the opening-balance movements are recorded under. */
const OPENING_ACTOR_EMAIL = 'manager01@erp.local';

export type FixtureSummary = {
  stores: number;
  suppliers: number;
  products: number;
  users: number;
};

export async function loadStartingFixture(prisma: PrismaClient): Promise<FixtureSummary> {
  const storeByCode = new Map<string, string>();
  for (const store of stores) {
    const row = await prisma.store.upsert({
      where: { code: store.code },
      update: { name: store.name },
      create: store,
    });
    storeByCode.set(store.code, row.id);
  }

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: { name: supplier.name },
      create: supplier,
    });
  }

  const productBySku = new Map<string, { id: string; name: string }>();
  for (const product of products) {
    const row = await prisma.product.upsert({
      where: { sku: product.sku },
      update: product,
      create: product,
    });
    productBySku.set(product.sku, { id: row.id, name: row.name });
    for (const storeId of storeByCode.values()) {
      await prisma.productReorderThreshold.upsert({
        where: { productId_storeId: { productId: row.id, storeId } },
        update: { threshold: SEED_REORDER_THRESHOLD },
        create: { productId: row.id, storeId, threshold: SEED_REORDER_THRESHOLD },
      });
    }
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userByEmail = new Map<string, string>();
  for (const user of demoUsers) {
    const storeId = user.storeCode ? storeByCode.get(user.storeCode) : null;
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash, storeId },
      create: { email: user.email, name: user.name, role: user.role, passwordHash, storeId },
    });
    userByEmail.set(user.email, row.id);
  }

  // Stock: a pair that has no balance yet gets its opening balance, written the way the ledger
  // writes everything: the balance plus a movement that explains it. A pair that already has a
  // balance is left alone, so re-seeding never undoes real stock changes.
  const actorId = userByEmail.get(OPENING_ACTOR_EMAIL)!;
  for (const [storeCode, storeId] of storeByCode) {
    for (const [sku, product] of productBySku) {
      const existing = await prisma.stockBalance.findUnique({
        where: { productId_storeId: { productId: product.id, storeId } },
      });
      if (existing) continue;

      const quantity = openingStock[storeCode]?.[sku] ?? 0;
      await prisma.$transaction(async (tx) => {
        await tx.stockBalance.create({ data: { productId: product.id, storeId, quantity } });
        if (quantity > 0) {
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              productSku: sku,
              productName: product.name,
              storeId,
              quantityChange: quantity,
              balanceBefore: 0,
              balanceAfter: quantity,
              movementType: StockMovementType.OPENING,
              sourceDocumentType: 'OPENING_BALANCE',
              actorId,
            },
          });
        }
      });
    }
  }

  return {
    stores: stores.length,
    suppliers: suppliers.length,
    products: products.length,
    users: demoUsers.length,
  };
}
