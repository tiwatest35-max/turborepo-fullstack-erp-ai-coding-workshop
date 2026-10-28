import { createPrismaClient, loadStartingFixture } from '@erp/database';
import { config } from './config.js';
import { planMovements } from './movement-plan.js';
import { NFR05 } from './verdict.js';

/**
 * Fills the performance database with the dataset NFR-05 names: 1,000 products and 10,000 stock
 * movements. The TOR starting data (stores B01 and B02, the five users, SKU001-003 and their
 * two opening movements) goes in first, so the dataset is the real data plus generated rows.
 */

const CATEGORIES = [
  'Beverages',
  'Household',
  'Snacks',
  'Personal care',
  'Frozen',
  'Bakery',
  'Dairy',
  'Pantry',
  'Pet',
  'Stationery',
];
const ADJECTIVES = [
  'Fresh',
  'Organic',
  'Classic',
  'Premium',
  'Family',
  'Travel',
  'Compact',
  'Value',
];
const NOUNS = ['Water', 'Tissue', 'Detergent', 'Noodles', 'Coffee', 'Soap', 'Rice', 'Snack', 'Tea'];
const UNITS = ['pack', 'bag', 'bottle', 'box'];
const BATCH = 1_000;

export type DatasetSummary = {
  products: number;
  movements: number;
  stores: { id: string; code: string }[];
  /** Search terms that exist in the data, for the load to ask for. */
  skus: string[];
  words: string[];
  /** The signed-in account the load uses. Not store-bound, so it sees every store. */
  userEmail: string;
};

export const LOAD_USER_EMAIL = 'manager01@erp.local';

const chunks = <T>(rows: T[]) =>
  Array.from({ length: Math.ceil(rows.length / BATCH) }, (_, i) =>
    rows.slice(i * BATCH, (i + 1) * BATCH),
  );

export async function seedPerfDataset(): Promise<DatasetSummary> {
  const prisma = createPrismaClient(config.perfDatabaseUrl);
  try {
    await loadStartingFixture(prisma);

    const startingProducts = await prisma.product.count();
    const startingMovements = await prisma.stockMovement.count();
    const generatedProducts = NFR05.products - startingProducts;
    const generatedMovements = NFR05.movements - startingMovements;

    const stores = await prisma.store.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true },
    });
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: LOAD_USER_EMAIL },
      select: { id: true },
    });

    const skuOf = (n: number) => `PERF-${String(n).padStart(4, '0')}`;
    const products = Array.from({ length: generatedProducts }, (_, i) => ({
      sku: skuOf(i + 1),
      name: `${ADJECTIVES[i % ADJECTIVES.length]} ${NOUNS[i % NOUNS.length]} ${i + 1}`,
      category: CATEGORIES[i % CATEGORIES.length]!,
      unit: UNITS[i % UNITS.length]!,
      sellingPrice: 10 + ((i * 7) % 490),
    }));
    for (const batch of chunks(products)) await prisma.product.createMany({ data: batch });

    const stored = await prisma.product.findMany({
      where: { sku: { startsWith: 'PERF-' } },
      orderBy: { sku: 'asc' },
      select: { id: true, sku: true, name: true },
    });

    // A threshold of 20 in every store makes the low-stock view return a real share of rows.
    const thresholds = stored.flatMap((product) =>
      stores.map((store) => ({ productId: product.id, storeId: store.id, threshold: 20 })),
    );
    for (const batch of chunks(thresholds)) {
      await prisma.productReorderThreshold.createMany({ data: batch });
    }

    const plan = planMovements({
      productCount: stored.length,
      storeCount: stores.length,
      movementCount: generatedMovements,
      seed: config.seed,
    });

    await prisma.stockBalance.createMany({
      data: plan.balances.map((balance) => ({
        productId: stored[balance.productIndex]!.id,
        storeId: stores[balance.storeIndex]!.id,
        quantity: balance.quantity,
      })),
    });

    const now = Date.now();
    const rows = plan.movements.map((movement) => {
      const product = stored[movement.productIndex]!;
      return {
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        storeId: stores[movement.storeIndex]!.id,
        quantityChange: movement.quantityChange,
        balanceBefore: movement.balanceBefore,
        balanceAfter: movement.balanceAfter,
        movementType: movement.movementType,
        sourceDocumentType: movement.sourceDocumentType,
        sourceDocumentNumber: movement.sourceDocumentNumber,
        actorId: actor.id,
        createdAt: new Date(now - movement.minutesAgo * 60_000),
      };
    });
    for (const batch of chunks(rows)) await prisma.stockMovement.createMany({ data: batch });

    // What autovacuum would have done by the time real data is this size.
    await prisma.$executeRawUnsafe('ANALYZE');

    return {
      products: await prisma.product.count(),
      movements: await prisma.stockMovement.count(),
      stores,
      skus: [1, 37, 118, 250, 404, 521, 666, 777, 890, generatedProducts].map(skuOf),
      words: NOUNS.map((noun) => noun.toLowerCase()),
      userEmail: LOAD_USER_EMAIL,
    };
  } finally {
    await prisma.$disconnect();
  }
}
