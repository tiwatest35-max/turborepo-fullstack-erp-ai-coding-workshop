import type { PurchaseOrderStatus } from '@erp/contracts';

/**
 * The status machine (PO-02): from each status, the statuses an order may move to. Anything
 * not listed is refused. Receiving (PARTIALLY_RECEIVED, COMPLETED) is reached by confirming
 * goods receipts; a further partial receipt leaves a PARTIALLY_RECEIVED order where it is.
 * Cancelling an Approved or partially received order is out of the initial release (PO-04).
 */
const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['PARTIALLY_RECEIVED', 'COMPLETED'],
  PARTIALLY_RECEIVED: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** The statuses a goods receipt can be confirmed against (GR-01). */
export const RECEIVABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  'APPROVED',
  'PARTIALLY_RECEIVED',
];

/** Every status an order can be in right before it moves to `to`. */
export function statusesBefore(to: PurchaseOrderStatus): PurchaseOrderStatus[] {
  return (Object.keys(TRANSITIONS) as PurchaseOrderStatus[]).filter((from) =>
    TRANSITIONS[from].includes(to),
  );
}
