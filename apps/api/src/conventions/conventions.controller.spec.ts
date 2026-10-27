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

  it('returns the standard actionable Thai error for a page past the end', async () => {
    const controller = await createController();

    await expect(call(controller.list(), { page: 999, pageSize: 10 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: { code: 'PAGE_OUT_OF_RANGE', action: 'correct_input' },
    });
  });

  it('carries a Thai message and no stack trace in the error payload', async () => {
    const controller = await createController();

    const error = await call(controller.list(), { page: 999, pageSize: 10 }).catch((e) => e);

    // The payload exposes only the safe, actionable fields — no stack, no DB detail.
    expect(error.data).toEqual({
      code: 'PAGE_OUT_OF_RANGE',
      messageTh: expect.stringContaining('หน้า'),
      action: 'correct_input',
    });
    expect(error.data).not.toHaveProperty('stack');
  });

  it('rejects an out-of-range pageSize with an input-validation error', async () => {
    const controller = await createController();

    // Assert the kind of failure, not merely that something threw: the contract's
    // input validation rejects pageSize 0 before the handler runs.
    await expect(call(controller.list(), { page: 1, pageSize: 0 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
