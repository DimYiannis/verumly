import { sql } from 'drizzle-orm';
import type { RollupDailyJob } from '@lr/db';
import type { WorkerCtx } from '../context.ts';

const AMSTERDAM_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD in Europe/Amsterdam, `daysBack` days before `now`. */
export function amsterdamDay(now: Date, daysBack = 0): string {
  return AMSTERDAM_DAY.format(new Date(now.getTime() - daysBack * 86_400_000));
}

/**
 * Recompute `merchant.daily_rollups` for [from, to] (Amsterdam days; default: the last 3 days) for one org or all orgs.
 * A receipt counts on the day of its latest version (when it became `paid` or `void`), the same day `vatByDay` uses.
 * Rows for the range are replaced in one transaction, so a receipt voided after an earlier run stops counting.
 * `gross` and `gross_*` are sums of signed `totals.gross` / `vatSummary` of `paid` receipts; `void_count` counts voids.
 */
export async function rollupDaily(ctx: WorkerCtx, job: RollupDailyJob = {}): Promise<{ rows: number }> {
  const from = job.from ?? amsterdamDay(ctx.now(), 2);
  const to = job.to ?? amsterdamDay(ctx.now(), 0);
  const org = job.orgId ? sql`and r.org_id = ${job.orgId}::uuid` : sql``;
  const range = sql`(v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date between ${from}::date and ${to}::date`;
  const orgDelete = job.orgId ? sql`and org_id = ${job.orgId}::uuid` : sql``;
  return ctx.db.transaction(async (tx) => {
    await tx.execute(sql`delete from merchant.daily_rollups where day between ${from}::date and ${to}::date ${orgDelete}`);
    const res = await tx.execute(sql`
      with per as (
        select r.location_id, r.org_id, r.state,
               (v.created_on_terminal_at at time zone 'Europe/Amsterdam')::date as day,
               (v.payload->'totals'->>'gross')::bigint as gross,
               coalesce((select sum((e->>'gross')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 21), 0) as g21,
               coalesce((select sum((e->>'vat')::bigint)   from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 21), 0) as v21,
               coalesce((select sum((e->>'gross')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 9), 0) as g9,
               coalesce((select sum((e->>'vat')::bigint)   from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 9), 0) as v9,
               coalesce((select sum((e->>'gross')::bigint) from jsonb_array_elements(v.payload->'vatSummary') e where (e->>'rate')::int = 0), 0) as g0
        from merchant.receipts r
        join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
        where r.state in ('paid', 'void') and ${range} ${org}
      )
      insert into merchant.daily_rollups (location_id, org_id, day, gross, gross_21, vat_21, gross_9, vat_9, gross_0, receipt_count, void_count)
      select location_id, org_id, day,
             coalesce(sum(gross) filter (where state = 'paid'), 0),
             coalesce(sum(g21) filter (where state = 'paid'), 0),
             coalesce(sum(v21) filter (where state = 'paid'), 0),
             coalesce(sum(g9) filter (where state = 'paid'), 0),
             coalesce(sum(v9) filter (where state = 'paid'), 0),
             coalesce(sum(g0) filter (where state = 'paid'), 0),
             count(*) filter (where state = 'paid'),
             count(*) filter (where state = 'void')
      from per
      group by location_id, org_id, day
    `);
    ctx.log('rollup_daily', { from, to, rows: res.rowCount ?? 0 });
    return { rows: res.rowCount ?? 0 };
  });
}
