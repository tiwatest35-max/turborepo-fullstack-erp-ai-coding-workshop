import { describe, expect, it } from 'vitest';
import {
  CreateSupplierInputSchema,
  SupplierSchema,
  UpdateSupplierInputSchema,
} from './supplier.js';

const full = {
  id: 'sup1',
  code: 'SUP01',
  name: 'SupplyOne Co Ltd',
  contactName: 'Somchai',
  contactPhone: '02-123-4567',
  contactEmail: 'sales@supplyone.co.th',
};

describe('SupplierSchema', () => {
  it('accepts a supplier with full contact details', () => {
    expect(SupplierSchema.safeParse(full).success).toBe(true);
  });

  it('accepts a supplier with no contact details', () => {
    const result = SupplierSchema.safeParse({
      id: 'sup2',
      code: 'SUP02',
      name: 'Minimal Supplier',
      contactName: null,
      contactPhone: null,
      contactEmail: null,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a supplier missing its code', () => {
    const { id: _id, code: _code, ...noCode } = full;
    expect(SupplierSchema.safeParse(noCode).success).toBe(false);
  });
});

describe('CreateSupplierInputSchema', () => {
  it('accepts a create payload without an id', () => {
    const { id: _id, ...create } = full;
    expect(CreateSupplierInputSchema.safeParse(create).success).toBe(true);
  });

  it('rejects an empty code', () => {
    const { id: _id, ...create } = full;
    expect(CreateSupplierInputSchema.safeParse({ ...create, code: '' }).success).toBe(false);
  });

  it('rejects an empty name', () => {
    const { id: _id, ...create } = full;
    expect(CreateSupplierInputSchema.safeParse({ ...create, name: '' }).success).toBe(false);
  });

  it('rejects an invalid contact email', () => {
    const { id: _id, ...create } = full;
    expect(
      CreateSupplierInputSchema.safeParse({ ...create, contactEmail: 'not-an-email' }).success,
    ).toBe(false);
  });

  it('rejects an unknown id field (id is server-assigned)', () => {
    expect(CreateSupplierInputSchema.safeParse(full).success).toBe(false);
  });
});

describe('UpdateSupplierInputSchema', () => {
  it('accepts an id with editable fields', () => {
    const result = UpdateSupplierInputSchema.safeParse({
      id: 'sup1',
      name: 'SupplyOne (Thailand) Co Ltd',
      contactPhone: '02-999-0000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an update without an id', () => {
    expect(UpdateSupplierInputSchema.safeParse({ name: 'No id' }).success).toBe(false);
  });
});
