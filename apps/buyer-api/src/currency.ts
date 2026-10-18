import { sql } from 'drizzle-orm';
import type { Db } from '@lr/db';

/**
 * The currency a person's totals are shown in: the currency of their latest final receipt (EUR for a new person).
 * Totals never add amounts of different currencies; receipts in another currency are still listed and shown in their own.
 */
export async function mainCurrency(db: Db, userId: string): Promise<string> {
  const res = await db.execute<{ currency: string }>(sql`
    select r.currency from buyer.claims c join merchant.receipts r on r.id = c.receipt_id
    where c.user_id = ${userId}::uuid and r.state in ('paid', 'fiscalised')
    order by r.created_on_terminal_at desc limit 1`);
  return res.rows[0]?.currency ?? 'EUR';
}
