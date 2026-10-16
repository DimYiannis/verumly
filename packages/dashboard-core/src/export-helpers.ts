import { sql } from 'drizzle-orm';
import { withOrg, type Db } from '@lr/db';
import { RUBRIEK, type VatDayRow } from './reports.ts';

/** One CSV cell. Quotes when needed and neutralises spreadsheet formulas (`=`, `+`, `-`, `@` at the start of text). */
export function csvCell(v: string | number | null): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const csvLine = (cells: Array<string | number | null>) => cells.map(csvCell).join(',');

export interface ExportReceiptRow {
  receiptId: string;
  /** Europe/Amsterdam calendar day of the latest version */
  day: string;
  time: string;
  location: string;
  state: string;
  gross: number;
  net: number;
  vat: number;
  tip: number;
  rounding: number;
  gross21: number;
  vat21: number;
  gross9: number;
  vat9: number;
  gross0: number;
  payment: string;
}

/**
 * One row per `paid` or `void` receipt whose latest version falls in [from, to] (Amsterdam days), oldest first.
 * Amounts are the signed totals/vatSummary of that latest version.
 */
export async function receiptsForExport(db: Db, orgId: string, from: string, to: string): Promise<ExportReceiptRow[]> {
  return withOrg(db, orgId, async (tx) => {
    const res = await tx.execute<{
      receipt_id: string; day: string; time: string; location: string; state: string;
      gross: string; net: string; vat: string; tip: string; rounding: string;
      gross_21: string; vat_21: string; gross_9: string; vat_9: string; gross_0: string; payment: string;
    }>(sql`
      select r.id as receipt_id,
             to_char(v.created_on_terminal_at at time zone 'Europe/Amsterdam', 'YYYY-MM-DD') as day,
             to_char(v.created_on_terminal_at at time zone 'Europe/Amsterdam', 'HH24:MI:SS') as time,
             l.name as location, r.state,
             (v.payload->'totals'->>'gross')::bigint as gross,
             (v.payload->'totals'->>'net')::bigint as net,
             (v.payload->'totals'->>'vat')::bigint as vat,
             (v.payload->'totals'->>'tip')::bigint as tip,
             (v.payload->'totals'->>'rounding')::bigint as rounding,
             coalesce((select sum((e->>'gross')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 21), 0) as gross_21,
             coalesce((select sum((e->>'vat')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 21), 0) as vat_21,
             coalesce((select sum((e->>'gross')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 9), 0) as gross_9,
             coalesce((select sum((e->>'vat')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 9), 0) as vat_9,
             coalesce((select sum((e->>'gross')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 0), 0) as gross_0,
             coalesce((select string_agg(distinct p->>'method', '+') from jsonb_array_elements(v.payload->'payments') p), '') as payment
      from merchant.receipts r
      join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
      join merchant.locations l on l.id = r.location_id
      where r.state in ('paid', 'void')
        and (v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date between ${from}::date and ${to}::date
      order by v.created_on_terminal_at, r.id
    `);
    return res.rows.map((r) => ({
      receiptId: r.receipt_id,
      day: r.day,
      time: r.time,
      location: r.location,
      state: r.state,
      gross: Number(r.gross),
      net: Number(r.net),
      vat: Number(r.vat),
      tip: Number(r.tip),
      rounding: Number(r.rounding),
      gross21: Number(r.gross_21),
      vat21: Number(r.vat_21),
      gross9: Number(r.gross_9),
      vat9: Number(r.vat_9),
      gross0: Number(r.gross_0),
      payment: r.payment,
    }));
  });
}

export function salesCsv(rows: ExportReceiptRow[]): string {
  const out = ['receipt_id,date,time,location,state,gross_cents,net_cents,vat_cents,tip_cents,rounding_cents,gross_21_cents,vat_21_cents,gross_9_cents,vat_9_cents,gross_0_cents,payment'];
  for (const r of rows) {
    out.push(csvLine([r.receiptId, r.day, r.time, r.location, r.state, r.gross, r.net, r.vat, r.tip, r.rounding, r.gross21, r.vat21, r.gross9, r.vat9, r.gross0, r.payment]));
  }
  return `${out.join('\n')}\n`;
}

/**
 * Accountant CSV: BTW per day and per rate (`scope=day`), then the period total per rate (`scope=period`).
 * `net_cents` is the turnover excluding BTW (omzet) that goes in rubriek 1a (21%), 1b (9%) or 1e (0% / out of scope);
 * `vat_cents` is the BTW due on it. Amounts in euro cents.
 */
export function btwAccountantCsv(rows: VatDayRow[], from: string, to: string): string {
  const out = ['scope,period,rubriek,rate,gross_cents,net_cents,vat_cents,receipts'];
  for (const r of rows) out.push(csvLine(['day', r.day, RUBRIEK[r.rate], r.rate, r.gross, r.net, r.vat, r.receipts]));
  const totals: Record<number, VatDayRow> = {};
  for (const r of rows) {
    const t = (totals[r.rate] ??= { day: '', rate: r.rate, gross: 0, net: 0, vat: 0, receipts: 0 });
    t.gross += r.gross;
    t.net += r.net;
    t.vat += r.vat;
    t.receipts += r.receipts;
  }
  for (const rate of [21, 9, 0] as const) {
    const t = totals[rate];
    if (t) out.push(csvLine(['period', `${from}..${to}`, RUBRIEK[rate], rate, t.gross, t.net, t.vat, t.receipts]));
  }
  return `${out.join('\n')}\n`;
}
