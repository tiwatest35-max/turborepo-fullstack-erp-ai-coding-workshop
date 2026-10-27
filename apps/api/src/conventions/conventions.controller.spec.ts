import { Test } from '@nestjs/testing';
import { call } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { ConventionsController } from './conventions.controller.js';

async function createController() {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConventionsController],
  }).compile();
  return moduleRef.get(ConventionsController);
}

describe('ConventionsController', () => {
  it('returns a paginated, newest-first page in the shared envelope', async () => {
    const controller = await createController();

    const result = await call(controller.list(), { page: 1, pageSize: 2 });

    expect(result).toMatchObject({ page: 1, pageSize: 2, hasMore: true });
    expect(result.total).toBeGreaterThan(2);
    expect(result.items).toHaveLength(2);
    // Newest-first: the first item is the highest-numbered seed.
    expect(result.items[0]!.id).toBe(`item-${result.total}`);
  });

  it('reports the last page with hasMore false', async () => {
    const controller = await createController();

    const result = await call(controller.list(), { page: 1, pageSize: 100 });

    expect(result.items).toHaveLength(result.total);
    expect(result.hasMore).toBe(false);
  });

  it('returns an empty page as a success envelope past the end', async () => {
    const controller = await createController();

    const result = await call(controller.list(), { page: 999, pageSize: 10 });

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.total).toBeGreaterThan(0);
  });

  it('rejects an out-of-range pageSize at the contract boundary', async () => {
    const controller = await createController();

    await expect(call(controller.list(), { page: 1, pageSize: 0 })).rejects.toBeDefined();
  });
});
