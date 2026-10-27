import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, PaginationInputSchema, paginated } from './conventions.js';

describe('PaginationInputSchema', () => {
  it('applies defaults when nothing is given', () => {
    const result = PaginationInputSchema.parse({});

    expect(result).toEqual({ page: 1, pageSize: 20 });
  });

  it('accepts an explicit page and pageSize', () => {
    expect(PaginationInputSchema.parse({ page: 3, pageSize: 50 })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('rejects a page below 1', () => {
    expect(PaginationInputSchema.safeParse({ page: 0 }).success).toBe(false);
  });

  it('rejects a non-integer page', () => {
    expect(PaginationInputSchema.safeParse({ page: 1.5 }).success).toBe(false);
  });

  it('rejects a pageSize above the maximum', () => {
    expect(PaginationInputSchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it('rejects a pageSize below 1', () => {
    expect(PaginationInputSchema.safeParse({ pageSize: 0 }).success).toBe(false);
  });
});

describe('paginated', () => {
  const Item = z.object({ id: z.string() });
  const Page = paginated(Item);

  it('accepts a well-formed page of items', () => {
    const result = Page.safeParse({
      items: [{ id: 'a' }, { id: 'b' }],
      page: 1,
      pageSize: 20,
      total: 2,
      hasMore: false,
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty page as a success envelope, distinct from an error', () => {
    const empty = { items: [], page: 1, pageSize: 20, total: 0, hasMore: false };

    expect(Page.safeParse(empty).success).toBe(true);
    // An empty page is a valid success payload, not an error payload.
    expect(ApiErrorSchema.safeParse(empty).success).toBe(false);
  });

  it('rejects items that do not match the item schema', () => {
    const result = Page.safeParse({
      items: [{ id: 123 }],
      page: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a page missing its metadata', () => {
    expect(Page.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('accepts an actionable Thai error telling the user to correct input', () => {
    const result = ApiErrorSchema.safeParse({
      code: 'VALIDATION',
      messageTh: 'ข้อมูลไม่ถูกต้อง',
      action: 'correct_input',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a retry error', () => {
    expect(
      ApiErrorSchema.safeParse({ code: 'INTERNAL', messageTh: 'ลองอีกครั้ง', action: 'retry' })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown action', () => {
    expect(ApiErrorSchema.safeParse({ code: 'X', messageTh: 'x', action: 'explode' }).success).toBe(
      false,
    );
  });
});
