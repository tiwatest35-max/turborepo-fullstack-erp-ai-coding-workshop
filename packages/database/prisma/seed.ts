import { createPrismaClient, DEMO_PASSWORD, loadStartingFixture } from '../src/index.js';

const prisma = createPrismaClient(
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp',
);

try {
  // The TOR Section 8.1 data lives in src/fixture.ts so the integration tests load the same thing.
  const loaded = await loadStartingFixture(prisma);
  console.log(
    `Seeded ${loaded.stores} stores, ${loaded.suppliers} suppliers, ${loaded.products} products, and ${loaded.users} users (password: "${DEMO_PASSWORD}"), with their opening stock.`,
  );
} finally {
  await prisma.$disconnect();
}
