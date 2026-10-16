import { eq } from 'drizzle-orm';
import { btwAccountantCsv, receiptsForExport, salesCsv, vatByDay } from '@lr/dashboard-core';
import { tables } from '@lr/db';
import type { ExportJob } from '@lr/db';
import type { WorkerCtx } from '../context.ts';

export const EXPORT_LINK_SECONDS = 24 * 3600;

export interface ExportOutcome {
  status: 'done' | 'skipped';
  key: string | null;
}

/**
 * Build the CSV for a queued `merchant.exports` row, upload it to S3 and store a presigned link valid for 24 hours.
 * `sales_csv`: one row per paid/void receipt. `btw_csv`: accountant file, VAT per day and rate plus period totals per
 * VAT return box (1a = 21%, 1b = 9%, 1e = 0% / out of scope). Failures mark the row `failed` and rethrow for the retry.
 */
export async function runExport(ctx: WorkerCtx, job: ExportJob): Promise<ExportOutcome> {
  const [row] = await ctx.db.select().from(tables.exportsTable).where(eq(tables.exportsTable.id, job.exportId));
  if (!row || row.status === 'done') return { status: 'skipped', key: null };
  try {
    await ctx.db.update(tables.exportsTable).set({ status: 'processing' }).where(eq(tables.exportsTable.id, row.id));
    let csv: string;
    if (row.kind === 'sales_csv') csv = salesCsv(await receiptsForExport(ctx.db, row.orgId, row.periodFrom, row.periodTo));
    else if (row.kind === 'btw_csv') csv = btwAccountantCsv(await vatByDay(ctx.db, row.orgId, row.periodFrom, row.periodTo), row.periodFrom, row.periodTo);
    else throw new Error(`unknown export kind ${row.kind}`);

    const key = `exports/${row.orgId}/${row.id}-${row.kind}-${row.periodFrom}_${row.periodTo}.csv`;
    await ctx.s3.put(key, csv, 'text/csv; charset=utf-8');
    const url = await ctx.s3.presignGet(key, EXPORT_LINK_SECONDS);
    await ctx.db
      .update(tables.exportsTable)
      .set({ status: 'done', s3Key: key, url, expiresAt: new Date(ctx.now().getTime() + EXPORT_LINK_SECONDS * 1000) })
      .where(eq(tables.exportsTable.id, row.id));
    ctx.log('export_done', { exportId: row.id, kind: row.kind });
    return { status: 'done', key };
  } catch (e) {
    await ctx.db.update(tables.exportsTable).set({ status: 'failed' }).where(eq(tables.exportsTable.id, row.id));
    throw e;
  }
}
