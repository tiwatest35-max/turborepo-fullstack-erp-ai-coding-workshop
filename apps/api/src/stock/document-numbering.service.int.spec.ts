import { describe, expect, it } from 'vitest';
import { useIntegrationDatabase } from '../test/integration.js';
import { DocumentNumberingService } from './document-numbering.service.js';

describe('DocumentNumberingService (real Postgres)', () => {
  const db = useIntegrationDatabase();
  const numbering = () => new DocumentNumberingService();
  const next = (prefix: string) => db.prisma.$transaction((tx) => numbering().next(tx, prefix));

  it('numbers a prefix 1, 2, 3 with a zero-padded counter', async () => {
    expect(await next('GR')).toBe('GR-000001');
    expect(await next('GR')).toBe('GR-000002');
    expect(await next('GR')).toBe('GR-000003');
  });

  it('counts each prefix on its own', async () => {
    expect(await next('GR')).toBe('GR-000001');
    expect(await next('SL')).toBe('SL-000001');
    expect(await next('GR')).toBe('GR-000002');
  });

  it('hands out unique numbers to concurrent documents', async () => {
    const numbers = await Promise.all(Array.from({ length: 25 }, () => next('GR')));

    expect(new Set(numbers).size).toBe(25);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 25 }, (_, i) => `GR-${String(i + 1).padStart(6, '0')}`),
    );
  });

  it('gives the number back when the document rolls back, so numbers have no gaps', async () => {
    await db.prisma
      .$transaction(async (tx) => {
        await numbering().next(tx, 'GR');
        throw new Error('the document failed');
      })
      .catch(() => undefined);

    expect(await next('GR')).toBe('GR-000001');
  });

  it('starts again from 1 after the harness resets between scenarios', async () => {
    expect(await next('PO')).toBe('PO-000001');
  });

  it.each(['', 'gr', 'G', 'TOOLONG', 'G R', 'GR-1'])('rejects the prefix %j', async (prefix) => {
    await expect(next(prefix)).rejects.toThrow(/prefix/i);
  });
});
