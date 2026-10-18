import { eq } from 'drizzle-orm';
import { tables, type Db } from '@lr/db';
import { categoriseLines, FUTURE_TOLERANCE_MS, lineTotal, vatFromGross } from '@lr/receipt-nl';
import { uploadExtracted, type ParsedLineDto, type ParsedReceiptDto, type UploadCategoriesBody, type UploadExtracted, type UploadPatchBody } from '@lr/schema';
import { claimedBy, loadReceipt } from './receipts.ts';

type UploadRow = typeof tables.uploads.$inferSelect;

export interface UploadView {
  uploadId: string;
  status: string;
  failures: string[];
  draft: null | {
    merchantName: string | null;
    printedAt: string | null;
    gross: number | null;
    rounding: number;
    lines: ParsedLineDto[];
    vatBreakdown: ParsedReceiptDto['vatBreakdown'];
    paymentMethod: ParsedReceiptDto['paymentMethod'];
  };
  matchedReceiptId: string | null;
  /** the official receipt found for this upload, while it is still unclaimed (or already yours) */
  match: null | { receiptId: string; merchantName: string; total: number; createdAt: string };
  createdAt: string;
}

export function readExtracted(row: Pick<UploadRow, 'extracted'>): UploadExtracted | null {
  const r = uploadExtracted.safeParse(row.extracted);
  return r.success ? r.data : null;
}

/** The API shape of an upload. `match` is dropped when someone else claimed the official receipt in the meantime. */
export async function uploadView(db: Db, userId: string, row: UploadRow): Promise<UploadView> {
  const extracted = readExtracted(row);
  const parsed = extracted?.parsed ?? null;
  let match: UploadView['match'] = null;
  let matchedReceiptId: string | null = null;
  if (row.matchedReceiptId && row.status !== 'replaced') {
    const owner = await claimedBy(db, row.matchedReceiptId);
    const receipt = !owner || owner === userId ? await loadReceipt(db, row.matchedReceiptId) : undefined;
    if (receipt) {
      matchedReceiptId = receipt.id;
      match = { receiptId: receipt.id, merchantName: receipt.crf.merchant.name, total: receipt.totalMinor, createdAt: receipt.createdOnTerminalAt.toISOString() };
    }
  } else if (row.status === 'replaced') {
    matchedReceiptId = row.matchedReceiptId;
  }
  return {
    uploadId: row.id,
    status: row.status,
    failures: extracted?.failures ?? [],
    draft: parsed
      ? {
          merchantName: parsed.merchant.name,
          printedAt: parsed.printedAtUtc,
          gross: parsed.gross,
          rounding: parsed.rounding,
          lines: parsed.lines,
          vatBreakdown: parsed.vatBreakdown,
          paymentMethod: parsed.paymentMethod,
        }
      : null,
    matchedReceiptId,
    match,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function ownUpload(db: Db, userId: string, uploadId: string): Promise<UploadRow | undefined> {
  const [row] = await db.select().from(tables.uploads).where(eq(tables.uploads.id, uploadId));
  return row && row.userId === userId ? row : undefined;
}

/** BTW per rate as implied by the lines (deposit lines are outside VAT); rounded per rate total like receipts. */
function vatFromLines(lines: ParsedLineDto[]): ParsedReceiptDto['vatBreakdown'] {
  const gross: Record<number, number> = {};
  for (const l of lines) if (l.vatRate !== null) gross[l.vatRate] = (gross[l.vatRate] ?? 0) + l.total;
  return Object.entries(gross)
    .map(([rate, g]) => ({ rate: Number(rate), g }))
    .sort((a, b) => b.rate - a.rate)
    .map(({ rate, g }) => {
      const { net, vat } = vatFromGross(g, rate);
      return { rate, base: net, vat };
    });
}

/**
 * Set or clear the buyer's category of single lines (`null` clears: the rules decide again). Nothing else changes: not
 * the total, the time, the status or the official-receipt match. Returns null when a line index does not exist.
 */
export function applyCategories(parsed: ParsedReceiptDto, body: UploadCategoriesBody): ParsedReceiptDto | null {
  const lines = parsed.lines.map((l) => ({ ...l }));
  for (const c of body.lines) {
    const line = lines[c.index];
    if (!line) return null;
    line.userCategory = c.category;
  }
  return { ...parsed, lines: categoriseLines(lines, parsed.merchant.name) };
}

const LINE_TOLERANCE = 2;

/**
 * Apply a buyer's corrections to an extracted draft and re-check it. The corrected draft is `done` when it is complete,
 * its date is not in the future, and its arithmetic holds: the lines sum exactly to the printed total, each line is qty × unit price within 2 cents,
 * and every non-deposit line has a BTW rate. BTW per rate is then derived from the (buyer-confirmed) lines.
 */
export function applyCorrections(parsed: ParsedReceiptDto, patch: UploadPatchBody): ParsedReceiptDto {
  const merchant = { ...parsed.merchant, name: patch.merchantName ?? parsed.merchant.name };
  // re-categorise after every correction; lines with a buyer-set category keep it (and are never made sensitive)
  const lines = categoriseLines(patch.lines ?? parsed.lines, merchant.name);
  const next: ParsedReceiptDto = {
    ...parsed,
    merchant,
    printedAtUtc: patch.printedAt ? new Date(patch.printedAt).toISOString() : parsed.printedAtUtc,
    gross: patch.gross ?? parsed.gross,
    lines,
    vatBreakdown: vatFromLines(lines),
  };
  const failures: string[] = [];
  if (!next.merchant.name) failures.push('merchant_missing');
  if (!next.printedAtUtc) failures.push('date_missing');
  else if (Date.parse(next.printedAtUtc) > Date.now() + FUTURE_TOLERANCE_MS) failures.push('date_future');
  if (next.gross === null) failures.push('gross_missing');
  if (lines.length === 0) failures.push('no_lines');
  if (next.gross !== null && lines.reduce((s, l) => s + l.total, 0) !== next.gross) failures.push('gross_sum');
  for (const l of lines) {
    if (l.kind !== 'deposit' && l.vatRate === null) failures.push('vat_missing');
    if (l.unitPrice !== null) {
      const expected = lineTotal(l.qty, l.unitPrice, 0);
      if (Math.abs(expected - l.total) > LINE_TOLERANCE) failures.push('line_total');
    }
  }
  const unique = [...new Set(failures)];
  return { ...next, status: unique.length === 0 ? 'done' : 'needs_review', failures: unique };
}
