/**
 * The performance dataset's stock ledger, planned in memory before anything is written.
 *
 * Every product is opened in every store first, then receipts, sales and adjustments move the
 * balances around. Each pair of product and store follows the ledger rules: a balance equals the
 * sum of its movements, never goes below zero, and no movement changes it by zero (INV-02, INV-03).
 * The plan is seeded, so the same inputs always give the same dataset.
 */

export type PlannedMovementType = 'OPENING' | 'RECEIPT' | 'SALE' | 'ADJUSTMENT';

export type PlannedMovement = {
  /** Position in the list of products and of stores the caller writes the plan into. */
  productIndex: number;
  storeIndex: number;
  quantityChange: number;
  balanceBefore: number;
  balanceAfter: number;
  movementType: PlannedMovementType;
  sourceDocumentType: string;
  /** Null for an opening balance, like the real ledger. */
  sourceDocumentNumber: string | null;
  /** How long before the run the movement happened. Later movements are more recent. */
  minutesAgo: number;
};

export type PlannedBalance = { productIndex: number; storeIndex: number; quantity: number };

export type MovementPlan = { movements: PlannedMovement[]; balances: PlannedBalance[] };

/** A small seeded generator (mulberry32), so a run can be repeated exactly. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MINUTES_BETWEEN_MOVEMENTS = 10;

export function planMovements(input: {
  productCount: number;
  storeCount: number;
  movementCount: number;
  seed: number;
}): MovementPlan {
  const { productCount, storeCount, movementCount } = input;
  const pairCount = productCount * storeCount;
  if (movementCount < pairCount) {
    throw new Error(
      `${movementCount} movements cannot open ${pairCount} product and store pairs (one each).`,
    );
  }

  const random = randomFrom(input.seed);
  const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const balanceOf = new Array<number>(pairCount).fill(0);
  const counters = { RECEIPT: 0, SALE: 0, ADJUSTMENT: 0 };
  const movements: PlannedMovement[] = [];

  const push = (
    pair: number,
    change: number,
    movementType: PlannedMovementType,
    sourceDocumentType: string,
    documentPrefix: string | null,
  ) => {
    const before = balanceOf[pair]!;
    const sequence = movementType === 'OPENING' ? 0 : ++counters[movementType];
    balanceOf[pair] = before + change;
    movements.push({
      productIndex: Math.floor(pair / storeCount),
      storeIndex: pair % storeCount,
      quantityChange: change,
      balanceBefore: before,
      balanceAfter: before + change,
      movementType,
      sourceDocumentType,
      // PERF- keeps these apart from real document numbers (GR-000001, SL-000001, ...).
      sourceDocumentNumber: documentPrefix
        ? `PERF-${documentPrefix}-${String(sequence).padStart(6, '0')}`
        : null,
      minutesAgo: (movementCount - movements.length) * MINUTES_BETWEEN_MOVEMENTS,
    });
  };

  for (let pair = 0; pair < pairCount; pair++) {
    push(pair, between(20, 200), 'OPENING', 'OPENING_BALANCE', null);
  }

  while (movements.length < movementCount) {
    const pair = between(0, pairCount - 1);
    const balance = balanceOf[pair]!;
    const roll = random();
    if (roll < 0.55 && balance > 0) {
      push(pair, -between(1, Math.min(balance, 5)), 'SALE', 'SALE', 'SL');
    } else if (roll < 0.85) {
      // Also taken by a sale roll on an empty shelf: nothing to sell, so stock arrives instead.
      push(pair, between(10, 100), 'RECEIPT', 'GOODS_RECEIPT', 'GR');
    } else {
      const decrease = balance > 1 && random() < 0.5;
      const change = decrease ? -between(1, Math.min(balance, 5)) : between(1, 10);
      push(pair, change, 'ADJUSTMENT', 'STOCK_ADJUSTMENT', 'ADJ');
    }
  }

  const balances = balanceOf.map((quantity, pair) => ({
    productIndex: Math.floor(pair / storeCount),
    storeIndex: pair % storeCount,
    quantity,
  }));
  return { movements, balances };
}
