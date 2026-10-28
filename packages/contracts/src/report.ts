import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ApiErrorSchema } from './conventions.js';
import { PriceSchema } from './product.js';

/**
 * The sales figures of one reporting day, or of the whole requested range. A confirmed sale
 * is one document; draft sales are never stored, so every document counted here was confirmed.
 */
export const SalesTotalsSchema = z.object({
  /** Number of confirmed sales documents. */
  documentCount: z.int().min(0),
  /** Whole units sold across those documents. */
  unitsSold: z.int().min(0),
  /** The sum of the document totals, in THB with two decimal places. */
  totalSales: PriceSchema,
});
export type SalesTotals = z.infer<typeof SalesTotalsSchema>;

/** One Asia/Bangkok reporting day that had at least one confirmed sale. */
export const DailySalesSchema = SalesTotalsSchema.extend({
  /** The Asia/Bangkok calendar day, `YYYY-MM-DD`. */
  date: z.iso.date(),
});
export type DailySales = z.infer<typeof DailySalesSchema>;

/**
 * The daily sales report filters (RPT-01). `from` and `to` are Asia/Bangkok calendar days and
 * both are included. A reporting day runs from 00:00:00 inclusive to the next day 00:00:00
 * exclusive in Asia/Bangkok, using the sale confirmation time.
 */
export const DailySalesReportInputSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    /** Only this store. A store employee always gets their own store. */
    storeId: z.string().min(1).optional(),
  })
  .refine((input) => input.from <= input.to, {
    message: 'The first day cannot be after the last day',
    path: ['from'],
  });
export type DailySalesReportInput = z.infer<typeof DailySalesReportInputSchema>;

export const DailySalesReportSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** The figures for the whole range. All zero when nothing matches. */
  totals: SalesTotalsSchema,
  /** One entry per Bangkok day with sales, newest first. Empty when nothing matches. */
  days: z.array(DailySalesSchema),
});
export type DailySalesReport = z.infer<typeof DailySalesReportSchema>;

export const reportContract = {
  dailySales: oc
    .route({
      method: 'GET',
      path: '/reports/sales/daily',
      summary:
        'Daily sales report by Asia/Bangkok day, filtered by date range and store (confirmed sales only)',
      tags: ['Reports'],
    })
    .errors({ FORBIDDEN: { data: ApiErrorSchema } })
    .input(DailySalesReportInputSchema)
    .output(DailySalesReportSchema),
};
