import { describe, expect, it } from 'vitest';
import { planMovements, type PlannedMovement } from './movement-plan.js';

const pairKey = (m: Pick<PlannedMovement, 'productIndex' | 'storeIndex'>) =>
  `${m.productIndex}:${m.storeIndex}`;

function byPair(movements: PlannedMovement[]) {
  const groups = new Map<string, PlannedMovement[]>();
  for (const movement of movements) {
    groups.set(pairKey(movement), [...(groups.get(pairKey(movement)) ?? []), movement]);
  }
  return groups;
}

describe('planMovements', () => {
  it('opens every product in every store before anything else happens to it', () => {
    const { movements } = planMovements({
      productCount: 2,
      storeCount: 1,
      movementCount: 2,
      seed: 1,
    });

    expect(movements.map((m) => [m.productIndex, m.storeIndex, m.movementType])).toEqual([
      [0, 0, 'OPENING'],
      [1, 0, 'OPENING'],
    ]);
    expect(movements.every((m) => m.balanceBefore === 0 && m.sourceDocumentNumber === null)).toBe(
      true,
    );
  });

  it('plans exactly the requested number of movements', () => {
    const { movements } = planMovements({
      productCount: 50,
      storeCount: 2,
      movementCount: 600,
      seed: 7,
    });

    expect(movements).toHaveLength(600);
  });

  it('keeps each balance equal to the sum of its movements and never below zero (INV-03)', () => {
    const { movements, balances } = planMovements({
      productCount: 50,
      storeCount: 2,
      movementCount: 600,
      seed: 7,
    });

    expect(balances).toHaveLength(100);
    for (const balance of balances) {
      const history = byPair(movements).get(pairKey(balance)) ?? [];
      const sum = history.reduce((total, m) => total + m.quantityChange, 0);
      expect(balance.quantity).toBe(sum);
      expect(balance.quantity).toBeGreaterThanOrEqual(0);
    }
  });

  it('chains the movements of a pair: each starts where the last one ended, none is zero', () => {
    const { movements } = planMovements({
      productCount: 50,
      storeCount: 2,
      movementCount: 600,
      seed: 7,
    });

    for (const history of byPair(movements).values()) {
      let running = 0;
      for (const m of history) {
        expect(m.balanceBefore).toBe(running);
        expect(m.quantityChange).not.toBe(0);
        expect(m.balanceAfter).toBe(m.balanceBefore + m.quantityChange);
        expect(m.balanceAfter).toBeGreaterThanOrEqual(0);
        running = m.balanceAfter;
      }
    }
  });

  it('spreads the movements over time, oldest first', () => {
    const { movements } = planMovements({
      productCount: 10,
      storeCount: 2,
      movementCount: 100,
      seed: 3,
    });

    const ages = movements.map((m) => m.minutesAgo);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
    expect(new Set(ages).size).toBe(100);
  });

  it('uses every movement type once the stores are open', () => {
    const { movements } = planMovements({
      productCount: 50,
      storeCount: 2,
      movementCount: 1_000,
      seed: 7,
    });

    expect(new Set(movements.map((m) => m.movementType))).toEqual(
      new Set(['OPENING', 'RECEIPT', 'SALE', 'ADJUSTMENT']),
    );
  });

  it('gives the same plan for the same seed and a different plan for another', () => {
    const input = { productCount: 20, storeCount: 2, movementCount: 200 };

    expect(planMovements({ ...input, seed: 5 })).toEqual(planMovements({ ...input, seed: 5 }));
    expect(planMovements({ ...input, seed: 5 })).not.toEqual(planMovements({ ...input, seed: 6 }));
  });

  it('refuses a plan too small to open every product in every store', () => {
    expect(() =>
      planMovements({ productCount: 10, storeCount: 2, movementCount: 19, seed: 1 }),
    ).toThrow(/open/i);
  });
});
