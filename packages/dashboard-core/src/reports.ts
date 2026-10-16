import { sql } from 'drizzle-orm';
import { withOrg, type Db } from '@lr/db';
import { DashboardError } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

export interface VatDayRow {
  day: string;
  rate: 21 | 9 | 0;
  gross: number;
  net: number;
  vat: number;
  receipts: number;
}

/**
 * BTW per day and per rate, computed from the latest version of every `paid` receipt (Europe/Amsterdam day).
 * Voided receipts are excluded. Amounts are the signed `vatSummary` rows, so they equal what was printed.
 */
export async function vatByDay(db: Db, orgId: string, from: string, to: string): Promise<VatDayRow[]> {
  return withOrg(db, orgId, async (tx) => {
    const res = await tx.execute<{ day: string; rate: number; gross: string; net: string; vat: string; receipts: string }>(sql`
      select to_char((v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date, 'YYYY-MM-DD') as day,
             (row->>'rate')::int as rate,
             sum((row->>'gross')::bigint) as gross,
             sum((row->>'net')::bigint) as net,
             sum((row->>'vat')::bigint) as vat,
             count(distinct r.id) as receipts
      from merchant.receipts r
      join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
      cross join lateral jsonb_array_elements(v.payload->'vatSummary') as row
      where r.state = 'paid'
        and (v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date between ${from}::date and ${to}::date
      group by 1, 2
      order by 1, 2 desc
    `);
    return res.rows.map((r) => ({
      day: r.day,
      rate: r.rate as 21 | 9 | 0,
      gross: Number(r.gross),
      net: Number(r.net),
      vat: Number(r.vat),
      receipts: Number(r.receipts),
    }));
  });
}

/** VAT return boxes: 1a = 21%, 1b = 9%, 1e = 0% / outside scope. */
export const RUBRIEK: Record<21 | 9 | 0, string> = { 21: '1a', 9: '1b', 0: '1e' };

export function vatCsv(rows: VatDayRow[]): string {
  const lines = ['date,vat_return_box,rate,gross_cents,net_cents,vat_cents,receipts'];
  for (const r of rows) lines.push([r.day, RUBRIEK[r.rate], r.rate, r.gross, r.net, r.vat, r.receipts].join(','));
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------- sales reports

export type Granularity = 'day' | 'month';

export interface ReportFilters {
  /** inclusive, YYYY-MM-DD, Europe/Amsterdam calendar days */
  from: string;
  to: string;
  granularity?: Granularity;
  locationId?: string;
}

export interface SalesRow {
  /** YYYY-MM-DD or YYYY-MM */
  period: string;
  /** paid receipts */
  receipts: number;
  gross: number;
  net: number;
  vat: number;
  tip: number;
  /** signed cents of 5-cent cash rounding */
  rounding: number;
  voids: number;
  voidGross: number;
}

export interface VatRateRow {
  period: string;
  rate: 21 | 9 | 0;
  gross: number;
  net: number;
  vat: number;
}

export interface SalesReport {
  sales: SalesRow[];
  vatByRate: VatRateRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Daily or monthly sales, BTW per rate and voids for the organisation. Computed from the latest version of each
 * receipt (so it is correct without waiting for the rollup job). A receipt counts on the Europe/Amsterdam day of
 * its latest version (the moment it reached its final state). `paid` receipts are sales; `void` receipts are voids
 * and are excluded from sales and BTW; `open`/`presented` receipts are neither.
 */
export async function salesReport(db: Db, actor: Actor, f: ReportFilters): Promise<SalesReport> {
  requireRole(actor, 'reports.read');
  if (!DATE_RE.test(f.from) || !DATE_RE.test(f.to)) throw new DashboardError('validation', 'from/to must be YYYY-MM-DD');
  const fmt = f.granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
  const loc = f.locationId ? sql`and r.location_id = ${f.locationId}::uuid` : sql``;
  const period = sql`to_char((v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date, ${fmt}::text)`;
  const range = sql`(v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date between ${f.from}::date and ${f.to}::date`;
  return withOrg(db, actor.orgId, async (tx) => {
    const sales = await tx.execute<{ period: string; state: string; receipts: string; gross: string; net: string; vat: string; tip: string; rounding: string }>(sql`
      select ${period} as period, r.state,
             count(*) as receipts,
             sum((v.payload->'totals'->>'gross')::bigint) as gross,
             sum((v.payload->'totals'->>'net')::bigint) as net,
             sum((v.payload->'totals'->>'vat')::bigint) as vat,
             sum((v.payload->'totals'->>'tip')::bigint) as tip,
             sum((v.payload->'totals'->>'rounding')::bigint) as rounding
      from merchant.receipts r
      join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
      where r.state in ('paid', 'void') and ${range} ${loc}
      group by 1, 2
    `);
    const rates = await tx.execute<{ period: string; rate: number; gross: string; net: string; vat: string }>(sql`
      select ${period} as period, (row->>'rate')::int as rate,
             sum((row->>'gross')::bigint) as gross, sum((row->>'net')::bigint) as net, sum((row->>'vat')::bigint) as vat
      from merchant.receipts r
      join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
      cross join lateral jsonb_array_elements(v.payload->'vatSummary') as row
      where r.state = 'paid' and ${range} ${loc}
      group by 1, 2
      order by 1, 2 desc
    `);
    const byPeriod: Record<string, SalesRow> = {};
    for (const r of sales.rows) {
      const row = (byPeriod[r.period] ??= { period: r.period, receipts: 0, gross: 0, net: 0, vat: 0, tip: 0, rounding: 0, voids: 0, voidGross: 0 });
      if (r.state === 'paid') Object.assign(row, { receipts: Number(r.receipts), gross: Number(r.gross), net: Number(r.net), vat: Number(r.vat), tip: Number(r.tip), rounding: Number(r.rounding) });
      else Object.assign(row, { voids: Number(r.receipts), voidGross: Number(r.gross) });
    }
    return {
      sales: Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period)),
      vatByRate: rates.rows.map((r) => ({ period: r.period, rate: r.rate as 21 | 9 | 0, gross: Number(r.gross), net: Number(r.net), vat: Number(r.vat) })),
    };
  });
}
