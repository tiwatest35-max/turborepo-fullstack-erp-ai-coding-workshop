import { createPrismaClient, hashPassword, Role } from '../src/index.js';

const prisma = createPrismaClient(
  process.env.DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp',
);

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

// Test users from TOR Section 8.1, with the roles from Section 2. Store employees
// are bound to one store; ADMIN and MANAGER are not store-bound.
const demoUsers = [
  { email: 'admin@erp.local', name: 'Admin User', role: Role.ADMIN, storeCode: null },
  { email: 'buyer01@erp.local', name: 'Buyer 01', role: Role.PURCHASING, storeCode: null },
  { email: 'manager01@erp.local', name: 'Manager 01', role: Role.MANAGER, storeCode: null },
  { email: 'staff_b01@erp.local', name: 'Staff B01', role: Role.STORE_EMPLOYEE, storeCode: 'B01' },
  { email: 'staff_b02@erp.local', name: 'Staff B02', role: Role.STORE_EMPLOYEE, storeCode: 'B02' },
];
const DEMO_PASSWORD = 'password';

async function main() {
  const storeIdByCode = new Map<string, string>();
  for (const store of stores) {
    const row = await prisma.store.upsert({
      where: { code: store.code },
      update: { name: store.name },
      create: store,
    });
    storeIdByCode.set(store.code, row.id);
  }

  for (const supplier of suppliers) {
    await prisma.supplier.upsert({
      where: { code: supplier.code },
      update: { name: supplier.name },
      create: supplier,
    });
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const user of demoUsers) {
    const storeId = user.storeCode ? storeIdByCode.get(user.storeCode) : null;
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash, storeId },
      create: { email: user.email, name: user.name, role: user.role, passwordHash, storeId },
    });
  }
  console.log(
    `Seeded ${stores.length} stores, ${suppliers.length} suppliers, and ${demoUsers.length} users (password: "${DEMO_PASSWORD}").`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
