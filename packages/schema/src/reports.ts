import { z } from 'zod';
import { uuidString } from './crf.ts';

/**
 * Customisable sales reports for the dashboard: the merchant picks the period, how to group, which metrics to show and
 * optional filters, and can save the setup as a named view. Money is integer cents. The report is computed from the latest
 * version of every receipt; `paid` receipts are sales and `void` receipts are cancellations.
 */

export const REPORT_GROUPS = ['day', 'week', 'month', 'weekday', 'hour', 'location', 'terminal', 'payment', 'vat_rate', 'category', 'item'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export const REPORT_METRICS = ['receipts', 'gross', 'net', 'vat', 'tip', 'rounding', 'cancelled', 'cancelledGross', 'avgTicket', 'items'] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

/** Groupings that come from a part of the receipt (a payment, a VAT row, a line) rather than the receipt itself. */
export const PARTIAL_GROUPS: readonly ReportGroup[] = ['payment', 'vat_rate', 'category', 'item'];
/** Which metrics mean something for each partial grouping; the others are 0 there. */
export const PARTIAL_METRICS: Record<string, readonly ReportMetric[]> = {
  payment: ['receipts', 'gross', 'avgTicket'],
  vat_rate: ['receipts', 'gross', 'net', 'vat', 'avgTicket'],
  category: ['receipts', 'gross', 'items', 'avgTicket'],
  item: ['receipts', 'gross', 'items', 'avgTicket'],
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportSpec = z
  .object({
    from: day,
    to: day,
    groupBy: z.enum(REPORT_GROUPS).default('day'),
    metrics: z
      .array(z.enum(REPORT_METRICS))
      .min(1)
      .max(REPORT_METRICS.length)
      .refine((m) => new Set(m).size === m.length, 'metrics must be unique'),
    locationId: uuidString.optional(),
    terminalId: uuidString.optional(),
    payment: z.enum(['card', 'cash', 'other']).optional(),
    /** only receipts of this weekday, Monday = 1 (Amsterdam time): "the usual Saturday" */
    weekday: z.number().int().min(1).max(7).optional(),
    /** also compute the same totals for the period just before (same length) */
    compare: z.boolean().default(false),
    sort: z.object({ by: z.union([z.literal('group'), z.enum(REPORT_METRICS)]), dir: z.enum(['asc', 'desc']) }).strict().optional(),
  })
  .strict()
  .refine((s) => s.from <= s.to, { message: 'from must not be after to', path: ['to'] });
export type ReportSpec = z.infer<typeof reportSpec>;

export type ReportValues = Partial<Record<ReportMetric, number>>;

export interface ReportRow {
  /** the raw group value: a date, ISO week, hour 0-23, weekday 1-7 (Monday = 1), an id, a method, a rate, a category */
  key: string;
  /** a readable name where the key is an id (location, terminal), else the key */
  label: string;
  values: ReportValues;
}

export interface ReportResult {
  spec: ReportSpec;
  rows: ReportRow[];
  totals: ReportValues;
  previous: { from: string; to: string; totals: ReportValues } | null;
  /** plain-language caveats for this grouping (for example that a metric does not apply) */
  notes: string[];
}

export const reportViewBody = z.object({ name: z.string().trim().min(1).max(60), spec: reportSpec }).strict();
export type ReportViewBody = z.infer<typeof reportViewBody>;

export interface ReportView {
  id: string;
  name: string;
  spec: ReportSpec;
  createdAt: string;
}
