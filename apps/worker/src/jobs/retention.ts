import { inArray, lt, sql } from 'drizzle-orm';
import { tables } from '@lr/db';
import type { WorkerCtx } from '../context.ts';

export const BUYER_HARD_DELETE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface RetentionOutcome {
  merchantReceiptsDeleted: number;
  buyersDeleted: number;
  s3ObjectsDeleted: number;
  emailCodesDeleted: number;
  sessionsDeleted: number;
  resolveFailuresDeleted: number;
  abandonedUploadsDeleted: number;
}

/**
 * Housekeeping, safe to run any number of times:
 * 1. delete merchant receipts older than their organisation's `retention_years` (versions and lines go with them;
 *    claims on them and idempotency keys are removed too, so nothing dangles);
 * 2. hard-delete buyers soft-deleted more than 30 days ago: their S3 objects first, then the user row, which cascades
 *    to sessions, push subscriptions, claims, uploads and consents; lead-uploader rows go as well (counts are recomputed);
 * 3. delete expired email codes and sessions, resolve-failure rows older than a day (the limit window is one hour), and
 *    uploads whose file never arrived within a day.
 * Merchant receipts of claimed receipts are NOT deleted when a buyer is deleted: they belong to the merchant (v2 §1).
 */
export async function retention(ctx: WorkerCtx): Promise<RetentionOutcome> {
  const now = ctx.now();

  // 1. merchant receipts past retention
  const expired = await ctx.db.execute<{ id: string }>(sql`
    delete from merchant.receipts r
    using merchant.organizations o
    where o.id = r.org_id
      and r.created_on_terminal_at < ${now.toISOString()}::timestamptz - make_interval(years => o.retention_years)
    returning r.id
  `);
  const receiptIds = expired.rows.map((r) => r.id);
  if (receiptIds.length > 0) {
    await ctx.db.delete(tables.claims).where(inArray(tables.claims.receiptId, receiptIds));
    await ctx.db.delete(tables.idempotencyKeys).where(inArray(tables.idempotencyKeys.receiptId, receiptIds));
  }

  // 2. buyers deleted > 30 days ago
  const cutoff = new Date(now.getTime() - BUYER_HARD_DELETE_DAYS * DAY_MS);
  const doomed = await ctx.db
    .select({ id: tables.users.id, email: tables.users.email })
    .from(tables.users)
    .where(lt(tables.users.deletedAt, cutoff));
  let s3ObjectsDeleted = 0;
  if (doomed.length > 0) {
    const ids = doomed.map((u) => u.id);
    const objects = await ctx.db.select({ key: tables.uploads.s3Key }).from(tables.uploads).where(inArray(tables.uploads.userId, ids));
    // objects first: if this throws the user rows survive and the next run retries
    for (const o of objects) {
      await ctx.s3.remove(o.key);
      s3ObjectsDeleted++;
    }
    await ctx.db.transaction(async (tx) => {
      const keys = await tx
        .delete(tables.unknownMerchantUploaders)
        .where(inArray(tables.unknownMerchantUploaders.userId, ids))
        .returning({ key: tables.unknownMerchantUploaders.merchantKey });
      for (const key of new Set(keys.map((k) => k.key))) {
        await tx.execute(sql`update leads.unknown_merchants set distinct_uploaders = (select count(*) from leads.unknown_merchant_uploaders where merchant_key = ${key}) where merchant_key = ${key}`);
      }
      await tx.delete(tables.emailCodes).where(inArray(tables.emailCodes.email, doomed.map((u) => u.email)));
      await tx.delete(tables.users).where(inArray(tables.users.id, ids));
      await tx.insert(tables.auditLog).values({ event: 'account_hard_deleted', detail: { count: ids.length } });
    });
  }

  // 3. expiry
  const codes = await ctx.db.delete(tables.emailCodes).where(lt(tables.emailCodes.expiresAt, now)).returning({ id: tables.emailCodes.id });
  const sessions = await ctx.db.delete(tables.sessions).where(lt(tables.sessions.expiresAt, now)).returning({ h: tables.sessions.tokenHash });
  const failures = await ctx.db
    .delete(tables.resolveFailures)
    .where(lt(tables.resolveFailures.at, new Date(now.getTime() - DAY_MS)))
    .returning({ id: tables.resolveFailures.id });
  const abandoned = await ctx.db.execute<{ s3_key: string }>(sql`
    delete from buyer.uploads where status = 'pending_upload' and created_at < ${new Date(now.getTime() - DAY_MS).toISOString()}::timestamptz returning s3_key
  `);
  for (const u of abandoned.rows) await ctx.s3.remove(u.s3_key);

  const out: RetentionOutcome = {
    merchantReceiptsDeleted: receiptIds.length,
    buyersDeleted: doomed.length,
    s3ObjectsDeleted,
    emailCodesDeleted: codes.length,
    sessionsDeleted: sessions.length,
    resolveFailuresDeleted: failures.length,
    abandonedUploadsDeleted: abandoned.rows.length,
  };
  ctx.log('retention', { ...out });
  return out;
}
