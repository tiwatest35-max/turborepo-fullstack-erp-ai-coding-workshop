import * as z from 'zod';

/**
 * Shared API conventions every list and mutation route reuses.
 *
 * - `PaginationInputSchema` is the input for every list route.
 * - `paginated(item)` is the output envelope for every list route. Lists are
 *   newest-first by convention; the handler is responsible for that ordering.
 * - `ApiErrorSchema` is the actionable error payload. It carries a Thai message
 *   and whether the user should correct their input or retry, and never a stack
 *   trace or database detail.
 */

// List routes are GET, so page/pageSize arrive as query strings over HTTP.
// Coerce to number before validating so `?page=2` is accepted, not rejected.
export const PaginationInputSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationInput = z.infer<typeof PaginationInputSchema>;

/** Wraps an item schema in the standard page envelope. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.int().min(1),
    pageSize: z.int().min(1),
    /** Total number of matching rows across all pages. */
    total: z.int().min(0),
    /** True when a further page exists after this one. */
    hasMore: z.boolean(),
  });
}

/** How the client should respond to an error. */
export const ErrorActionSchema = z.enum(['correct_input', 'retry']);
export type ErrorAction = z.infer<typeof ErrorActionSchema>;

/**
 * The actionable error payload. `messageTh` is a Thai, user-facing message with
 * no stack trace or database detail; `action` tells the UI whether the user
 * should fix their input or retry the operation.
 */
export const ApiErrorSchema = z.object({
  code: z.string(),
  messageTh: z.string(),
  action: ErrorActionSchema,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * Builds the actionable error payload handlers attach to a thrown error.
 * Using this is how a feature returns the standard Thai error shape instead of
 * a raw exception; it carries only the safe fields (never a stack trace or DB
 * detail). Handlers throw an ORPCError whose `data` is the result of this.
 */
export function apiError(code: string, messageTh: string, action: ErrorAction): ApiError {
  return { code, messageTh, action };
}

/**
 * A CSV file an export route returns (RPT-04). `content` is the whole file as text and starts
 * with a U+FEFF byte-order mark, so a client that saves it as UTF-8 writes the EF BB BF bytes
 * spreadsheet software needs to show Thai text correctly. `filename` is the suggested name.
 */
export const CsvExportSchema = z.object({
  filename: z.string().min(1),
  content: z.string().startsWith('\uFEFF'),
});
export type CsvExport = z.infer<typeof CsvExportSchema>;

/**
 * The key a client sends with a write that must not happen twice (GR-04), e.g. a goods receipt
 * or a sale. The client makes one up (a UUID is fine) when the user starts the operation and
 * sends the same key again on every retry or double click. The server answers a repeat with the
 * first result; a deliberately new operation uses a new key.
 */
export const IdempotencyKeySchema = z.string().min(8).max(128);
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
