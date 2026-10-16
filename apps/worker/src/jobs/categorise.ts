import { sql } from 'drizzle-orm';
import { categoriseLine } from '@lr/receipt-nl';
import type { WorkerCtx } from '../context.ts';

const BATCH = 500;

/**
 * Fill `receipt_lines.category` where it is null (terminal-supplied categories are never overwritten) and set
 * `sensitive` for health lines. Lines the rules do not know get `overig`, so each line is processed once.
 * Returns the number of lines updated.
 */
export async function categorise(ctx: WorkerCtx): Promise<{ lines: number; sensitive: number }> {
  let lines = 0;
  let sensitive = 0;
  for (;;) {
    const res = await ctx.db.execute<{ receipt_id: string; line_no: number; description: string; merchant_name: string | null }>(sql`
      select l.receipt_id, l.line_no, l.description, v.payload->'merchant'->>'name' as merchant_name
      from merchant.receipt_lines l
      join merchant.receipts r on r.id = l.receipt_id
      join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
      where l.category is null
      order by l.receipt_id, l.line_no
      limit ${BATCH}
    `);
    if (res.rows.length === 0) break;
    const verdicts = res.rows.map((r) => categoriseLine({ description: r.description, merchantName: r.merchant_name }));
    const verdictRows = res.rows.map((r, i) => ({ receipt_id: r.receipt_id, line_no: r.line_no, category: verdicts[i]!.category, sensitive: verdicts[i]!.sensitive }));
    await ctx.db.execute(sql`
      update merchant.receipt_lines l
      set category = u.category, sensitive = u.sensitive
      from jsonb_to_recordset(${JSON.stringify(verdictRows)}::jsonb) as u(receipt_id uuid, line_no int, category text, sensitive boolean)
      where l.receipt_id = u.receipt_id and l.line_no = u.line_no and l.category is null
    `);
    lines += res.rows.length;
    sensitive += verdicts.filter((v) => v.sensitive).length;
    if (res.rows.length < BATCH) break;
  }
  ctx.log('categorise', { lines, sensitive });
  return { lines, sensitive };
}
