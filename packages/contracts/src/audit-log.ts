import { oc } from '@orpc/contract';
import * as z from 'zod';
import { PaginationInputSchema, paginated } from './conventions.js';

/** What an audited action decided. Later audited actions add their outcomes. */
export const AuditOutcomeSchema = z.enum(['APPROVED', 'REJECTED']);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/**
 * One line of the append-only audit log: who did what to which document, when, and how it
 * turned out. There is no way to change one, and it never carries a password, token or secret.
 */
export const AuditLogEntrySchema = z.object({
  id: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  /** The kind of document acted on, e.g. `PURCHASE_ORDER`. */
  sourceDocumentType: z.string(),
  /** The document number, e.g. `PO-000001`. */
  sourceDocumentNumber: z.string(),
  outcome: AuditOutcomeSchema,
  /** The reason the actor gave. Null when none was asked for. */
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const auditLogContract = {
  // Read-only on purpose: a recorded action cannot be edited or deleted.
  list: oc
    .route({
      method: 'GET',
      path: '/audit-log',
      summary: 'List audit log entries, newest first (managers and admins)',
      tags: ['Audit log'],
    })
    .input(PaginationInputSchema)
    .output(paginated(AuditLogEntrySchema)),
};
