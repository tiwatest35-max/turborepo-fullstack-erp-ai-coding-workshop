import { describe, expect, it } from 'vitest';
import { contract } from './index.js';
import { CreateStoreInputSchema, StoreSchema, UpdateStoreInputSchema } from './store.js';

const full = { id: 'st1', code: 'B01', name: 'Central Store' };

describe('StoreSchema', () => {
  it('accepts a store with a code and name', () => {
    expect(StoreSchema.safeParse(full).success).toBe(true);
  });

  it('rejects a store missing its code', () => {
    expect(StoreSchema.safeParse({ id: 'st1', name: 'Central Store' }).success).toBe(false);
  });
});

describe('CreateStoreInputSchema', () => {
  it('accepts a create payload without an id', () => {
    expect(CreateStoreInputSchema.safeParse({ code: 'B03', name: 'Harbour Store' }).success).toBe(
      true,
    );
  });

  it('rejects an empty code', () => {
    expect(CreateStoreInputSchema.safeParse({ code: '', name: 'Harbour Store' }).success).toBe(
      false,
    );
  });

  it('rejects an empty name', () => {
    expect(CreateStoreInputSchema.safeParse({ code: 'B03', name: '' }).success).toBe(false);
  });

  it('rejects an id (id is server-assigned)', () => {
    expect(CreateStoreInputSchema.safeParse(full).success).toBe(false);
  });
});

describe('UpdateStoreInputSchema', () => {
  it('accepts an id with editable fields', () => {
    expect(UpdateStoreInputSchema.safeParse({ id: 'st1', name: 'Central Plaza' }).success).toBe(
      true,
    );
  });

  it('rejects an update without an id', () => {
    expect(UpdateStoreInputSchema.safeParse({ name: 'No id' }).success).toBe(false);
  });

  it('rejects an empty name on update', () => {
    expect(UpdateStoreInputSchema.safeParse({ id: 'st1', name: '' }).success).toBe(false);
  });
});

describe('contract.stores', () => {
  it('exposes list, get, create and update routes', () => {
    expect(Object.keys(contract.stores).sort()).toEqual(['create', 'get', 'list', 'update']);
  });
});
