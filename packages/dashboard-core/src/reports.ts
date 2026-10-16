import { sql } from 'drizzle-orm';
import { withOrg, type Db } from '@lr/db';

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
        and (r.created_on_terminal_at at time zone 'Europe/Amsterdam')::date between ${from}::date and ${to}::date
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

/** Aangifte omzetbelasting rubrieken: 1a = 21%, 1b = 9%, 1e = 0% / outside scope. */
export const RUBRIEK: Record<21 | 9 | 0, string> = { 21: '1a', 9: '1b', 0: '1e' };

export function vatCsv(rows: VatDayRow[]): string {
  const lines = ['date,rubriek,rate,gross_cents,net_cents,vat_cents,receipts'];
  for (const r of rows) lines.push([r.day, RUBRIEK[r.rate], r.rate, r.gross, r.net, r.vat, r.receipts].join(','));
  return `${lines.join('\n')}\n`;
}
