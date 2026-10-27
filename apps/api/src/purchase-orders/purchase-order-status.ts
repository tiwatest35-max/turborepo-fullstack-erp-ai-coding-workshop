import type { PurchaseOrderStatus } from '@erp/contracts';

/**
 * The status machine (PO-02): from each status, the statuses an order may move to. Anything
 * not listed is refused. Receiving (PARTIALLY_RECEIVED, COMPLETED) is reached by goods
 * receipts, which come with their own ticket; the moves are listed here so the table is whole.
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

/** Every status an order can be in right before it moves to `to`. */
export function statusesBefore(to: PurchaseOrderStatus): PurchaseOrderStatus[] {
  return (Object.keys(TRANSITIONS) as PurchaseOrderStatus[]).filter((from) =>
    TRANSITIONS[from].includes(to),
  );
}
