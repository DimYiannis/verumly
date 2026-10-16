import { eq, or, sql } from 'drizzle-orm';
import type { Db } from './index.ts';
import * as t from './schema.ts';

/** An upload is matched to an official receipt printed within this many minutes of the paper receipt's time. */
export const MATCH_WINDOW_MINUTES = 30;

/**
 * Organisations whose KvK number or BTW-id equals the extracted one. Either identifier is enough, so a receipt that
 * prints no BTW-id is still recognised by KvK.
 */
export async function orgIdsByIdentifiers(db: Db, ids: { kvkNumber: string | null; vatNumber: string | null }): Promise<string[]> {
  const conds = [];
  if (ids.vatNumber) conds.push(eq(t.organizations.vatNumber, ids.vatNumber));
  if (ids.kvkNumber) conds.push(eq(t.organizations.kvkNumber, ids.kvkNumber));
  if (conds.length === 0) return [];
  const rows = await db.select({ id: t.organizations.id }).from(t.organizations).where(or(...conds));
  return rows.map((r) => r.id);
}

/**
 * An unclaimed, non-open, non-void receipt of one of `orgIds` with the same gross whose creation or latest version is
 * within ±30 minutes of the printed time. The closest one wins. Runs as `buyer_api` or `worker` (both may read these).
 */
export async function findMatchingReceipt(db: Db, orgIds: string[], gross: number, printedAtUtc: string): Promise<string | null> {
  if (orgIds.length === 0) return null;
  const printed = new Date(printedAtUtc);
  if (Number.isNaN(printed.getTime())) return null;
  const at = printed.toISOString();
  const distance = sql`least(
    abs(extract(epoch from (r.created_on_terminal_at - ${at}::timestamptz))),
    abs(extract(epoch from (v.created_on_terminal_at - ${at}::timestamptz)))
  )`;
  const rows = await db.execute<{ id: string }>(sql`
    select r.id
    from merchant.receipts r
    join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
    where r.org_id in (${sql.join(orgIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and r.state not in ('open', 'void')
      and r.total_minor = ${gross}
      and ${distance} <= ${MATCH_WINDOW_MINUTES * 60}
      and not exists (select 1 from buyer.claims c where c.receipt_id = r.id)
    order by ${distance}, r.id
    limit 1
  `);
  return rows.rows[0]?.id ?? null;
}
