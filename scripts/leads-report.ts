import { sql } from 'drizzle-orm';
import { dbEnvSchema, loadEnv } from '@lr/config';
import { connect } from '@lr/db';

/**
 * `pnpm leads:report`: sales-lead counts from unknown-merchant uploads (v2 §12: there is no /admin UI).
 * Counts only: no merchant names, keys or uploader ids are printed.
 */
const env = loadEnv(dbEnvSchema);
const { db, close } = connect('worker', env);
try {
  const byStatus = await db.execute<{ status: string; leads: number; uploads: number }>(sql`
    select status, count(*)::int as leads, coalesce(sum(distinct_uploaders), 0)::int as uploads
    from leads.unknown_merchants group by status order by status`);
  const buckets = await db.execute<{ bucket: string; leads: number }>(sql`
    select case when distinct_uploaders >= 20 then '20+' when distinct_uploaders >= 10 then '10-19' when distinct_uploaders >= 5 then '5-9' else '1-4' end as bucket,
           count(*)::int as leads
    from leads.unknown_merchants group by 1 order by min(distinct_uploaders)`);
  const totals = byStatus.rows.reduce((t, r) => ({ leads: t.leads + r.leads, uploaders: t.uploaders + r.uploads }), { leads: 0, uploaders: 0 });

  console.log('Sales leads (unknown merchants seen in buyer uploads)');
  console.log(`  unknown merchants: ${totals.leads}`);
  for (const r of byStatus.rows) console.log(`  status ${r.status}: ${r.leads} merchants, ${r.uploads} distinct (merchant, uploader) pairs`);
  console.log('  merchants by number of distinct uploaders:');
  for (const b of buckets.rows) console.log(`    ${b.bucket}: ${b.leads}`);
  console.log('  ("new" = reached LEAD_THRESHOLD distinct uploaders, default 20)');
} finally {
  await close();
}
