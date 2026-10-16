import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { tables, withOrg, type Db } from '@lr/db';
import { crf as crfSchema } from '@lr/schema';

export interface ArchiveFilters {
  from?: string;
  to?: string;
  state?: string;
  q?: string;
  /** exact gross in cents */
  amount?: number;
  limit?: number;
  offset?: number;
}

/**
 * Archive search for a merchant organisation. Runs as the `dashboard` role with `app.org_id` set, so row-level
 * security scopes it to the org. Output never contains any buyer information (none exists on this side).
 */
export async function searchArchive(db: Db, orgId: string, f: ArchiveFilters = {}) {
  return withOrg(db, orgId, async (tx) => {
    const conds = [];
    if (f.from) conds.push(gte(tables.receipts.createdOnTerminalAt, new Date(`${f.from}T00:00:00Z`)));
    if (f.to) conds.push(lte(tables.receipts.createdOnTerminalAt, new Date(`${f.to}T23:59:59.999Z`)));
    if (f.state) conds.push(eq(tables.receipts.state, f.state));
    if (f.amount !== undefined) conds.push(eq(tables.receipts.totalMinor, f.amount));
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      conds.push(
        sql`(${tables.receipts.id}::text ilike ${like} or exists (select 1 from merchant.receipt_lines l where l.receipt_id = ${tables.receipts.id} and l.description ilike ${like}))`,
      );
    }
    return tx
      .select({
        id: tables.receipts.id,
        locationName: tables.locations.name,
        state: tables.receipts.state,
        currentVersion: tables.receipts.currentVersion,
        totalMinor: tables.receipts.totalMinor,
        currency: tables.receipts.currency,
        createdAt: tables.receipts.createdOnTerminalAt,
        receivedAt: tables.receipts.receivedAt,
      })
      .from(tables.receipts)
      .innerJoin(tables.locations, eq(tables.locations.id, tables.receipts.locationId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(tables.receipts.createdOnTerminalAt), desc(tables.receipts.id))
      .limit(Math.min(f.limit ?? 50, 200))
      .offset(f.offset ?? 0);
  });
}

export async function getReceiptWithVersions(db: Db, orgId: string, receiptId: string) {
  return withOrg(db, orgId, async (tx) => {
    const [receipt] = await tx.select().from(tables.receipts).where(eq(tables.receipts.id, receiptId));
    if (!receipt) return null;
    const versions = await tx
      .select({
        version: tables.receiptVersions.version,
        state: tables.receiptVersions.state,
        payload: tables.receiptVersions.payload,
        receivedAt: tables.receiptVersions.receivedAt,
      })
      .from(tables.receiptVersions)
      .where(eq(tables.receiptVersions.receiptId, receiptId))
      .orderBy(asc(tables.receiptVersions.version));
    return {
      id: receipt.id,
      state: receipt.state,
      currentVersion: receipt.currentVersion,
      totalMinor: receipt.totalMinor,
      versions: versions.map((v) => ({ version: v.version, state: v.state, receivedAt: v.receivedAt, crf: crfSchema.parse(v.payload) })),
    };
  });
}
