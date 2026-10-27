import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';
export { DEMO_PASSWORD, loadStartingFixture, type FixtureSummary } from './fixture.js';
export { hashPassword, verifyPassword } from './password.js';

/** Prisma 7 talks to Postgres through a driver adapter (node-postgres). */
export function createPrismaAdapter(connectionString: string) {
  return new PrismaPg({ connectionString });
}

export function createPrismaClient(connectionString: string) {
  return new PrismaClient({ adapter: createPrismaAdapter(connectionString) });
}
