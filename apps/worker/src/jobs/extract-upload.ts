import { and, count, eq, sql } from 'drizzle-orm';
import { sha256Hex } from '@lr/crypto';
import { findMatchingReceipt, orgIdsByIdentifiers, tables } from '@lr/db';
import type { ExtractUploadJob } from '@lr/db';
import { categoriseLines, parseExtraction } from '@lr/receipt-nl';
import type { UploadExtracted } from '@lr/schema';
import type { WorkerCtx } from '../context.ts';
import { ExtractionTimeoutError, PermanentExtractionError } from '../extractor.ts';

export interface ExtractOutcome {
  status: 'done' | 'needs_review' | 'failed' | 'skipped';
  matchedReceiptId: string | null;
  lead: 'none' | 'collecting' | 'new';
}

async function fail(ctx: WorkerCtx, uploadId: string, code: string): Promise<ExtractOutcome> {
  const extracted: UploadExtracted = { parsed: null, failures: [code], modelRevision: null, corrected: false };
  await ctx.db.update(tables.uploads).set({ status: 'failed', extracted }).where(eq(tables.uploads.id, uploadId));
  ctx.log('extract_failed', { uploadId, code });
  return { status: 'failed', matchedReceiptId: null, lead: 'none' };
}

/** Count `userId` once per merchant key; at `threshold` distinct uploaders the lead becomes `new`. */
export async function recordLead(
  ctx: WorkerCtx,
  key: string,
  merchant: { name: string | null; postcode: string | null },
  userId: string,
): Promise<'collecting' | 'new'> {
  return ctx.db.transaction(async (tx) => {
    await tx.insert(tables.unknownMerchants).values({ merchantKey: key, name: merchant.name, postcode: merchant.postcode }).onConflictDoNothing();
    // lock the lead row so concurrent uploads of the same merchant count one after the other
    await tx.select({ k: tables.unknownMerchants.merchantKey }).from(tables.unknownMerchants).where(eq(tables.unknownMerchants.merchantKey, key)).for('update');
    await tx.insert(tables.unknownMerchantUploaders).values({ merchantKey: key, userId }).onConflictDoNothing();
    const [counted] = await tx.select({ n: count() }).from(tables.unknownMerchantUploaders).where(eq(tables.unknownMerchantUploaders.merchantKey, key));
    const n = counted?.n ?? 0;
    const [row] = await tx
      .update(tables.unknownMerchants)
      .set({
        distinctUploaders: n,
        status: sql`case when ${tables.unknownMerchants.status} = 'collecting' and ${n} >= ${ctx.leadThreshold} then 'new' else ${tables.unknownMerchants.status} end`,
      })
      .where(eq(tables.unknownMerchants.merchantKey, key))
      .returning({ status: tables.unknownMerchants.status });
    return row?.status === 'new' ? 'new' : 'collecting';
  });
}

/**
 * Extract an uploaded receipt photo: S3 → Extractor → deterministic parser → `done` / `needs_review`, then either match
 * an official receipt (known merchant) or count the merchant as a lead (unknown merchant).
 *
 * Transient errors (network, S3) are rethrown so pg-boss retries; on the final attempt, or on a permanent error, the
 * upload becomes `failed` with a machine-readable failure code.
 */
export async function extractUpload(ctx: WorkerCtx, job: ExtractUploadJob, opts: { finalAttempt?: boolean } = {}): Promise<ExtractOutcome> {
  const [upload] = await ctx.db.select().from(tables.uploads).where(eq(tables.uploads.id, job.uploadId));
  if (!upload || upload.status !== 'processing') return { status: 'skipped', matchedReceiptId: null, lead: 'none' };

  let extraction;
  let sha: string;
  try {
    const bytes = await ctx.s3.get(upload.s3Key);
    sha = sha256Hex(bytes);
    extraction = await ctx.extractor.extract(bytes);
  } catch (e) {
    if (e instanceof PermanentExtractionError) return fail(ctx, upload.id, e.code);
    if (opts.finalAttempt) return fail(ctx, upload.id, e instanceof ExtractionTimeoutError ? 'extraction_timeout' : 'extractor_unavailable');
    throw e;
  }

  const read = parseExtraction({ markdown: extraction.markdown, kie: extraction.kie }, { now: ctx.now() });
  // store the category (and health flag) of every line now, so lists and insights never re-derive them
  const parsed = { ...read, lines: categoriseLines(read.lines, read.merchant.name) };

  let matchedReceiptId: string | null = null;
  let lead: ExtractOutcome['lead'] = 'none';
  const orgIds = await orgIdsByIdentifiers(ctx.db, parsed.merchant);
  if (orgIds.length > 0) {
    if (parsed.gross !== null && parsed.printedAtUtc !== null) matchedReceiptId = await findMatchingReceipt(ctx.db, orgIds, parsed.gross, parsed.printedAtUtc);
  } else if (parsed.merchantKey) {
    lead = await recordLead(ctx, parsed.merchantKey, { name: parsed.merchant.name, postcode: parsed.merchant.postcode }, upload.userId);
  }

  const extracted: UploadExtracted = { parsed, failures: parsed.failures, modelRevision: extraction.modelRevision, corrected: false };
  await ctx.db
    .update(tables.uploads)
    .set({ status: parsed.status, sha256: sha, extracted, merchantKey: parsed.merchantKey, matchedReceiptId })
    .where(and(eq(tables.uploads.id, upload.id), eq(tables.uploads.status, 'processing')));
  ctx.log('extract_done', { uploadId: upload.id, status: parsed.status, matched: matchedReceiptId !== null, lead });
  return { status: parsed.status, matchedReceiptId, lead };
}
