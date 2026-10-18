import { z } from 'zod';
import type { Crf } from '@lr/schema';
import { cashRounding, divRoundHalfUp, qtyToMilli, vatFromGross } from './money.ts';
import { merchantKeyOf, normaliseBtwId, normaliseKvk, normalisePostcode } from './ids.ts';
import { parseCents, parseQty, parseVatRate } from './numbers.ts';
import { printedToUtc } from './time.ts';
import { normaliseOcrText } from './text.ts';
import { deriveVatSummary, validateCrf } from './validate.ts';

export interface ParsedLine {
  description: string;
  qty: string;
  unitPrice: number | null;
  total: number;
  vatRate: 21 | 9 | 0 | null;
  kind: 'item' | 'discount' | 'deposit';
}

export interface ParsedReceipt {
  status: 'done' | 'needs_review';
  /** names of failed checks, [] when done */
  failures: string[];
  merchant: { name: string | null; kvkNumber: string | null; vatNumber: string | null; postcode: string | null };
  /** first existing of `vat:<btw-id>`, `kvk:<kvk>`, `name:<normalised name>|<postcode>` */
  merchantKey: string | null;
  /** ISO UTC; the printed time is Europe/Amsterdam local */
  printedAtUtc: string | null;
  lines: ParsedLine[];
  gross: number | null;
  rounding: number;
  vatBreakdown: { rate: number; base: number | null; vat: number }[];
  paymentMethod: 'card' | 'cash' | 'other' | null;
}

/** 2 cents of slack for line arithmetic (qty × unit price vs printed line total). Total/BTW agreement is exact. */
const TOLERANCE = 2;

type Method = 'card' | 'cash' | 'other';

// ---------------------------------------------------------------------------------------------
// KIE (the model's JSON answer)

const scalar = z.union([z.string(), z.number()]).nullable().optional();
const kieSchema = z.object({
  merchant_name: scalar,
  kvk_number: scalar,
  btw_number: scalar,
  postcode: scalar,
  date: scalar,
  time: scalar,
  lines: z
    .array(z.object({ description: scalar, qty: scalar, unit_price: scalar, total: scalar, btw_rate: scalar }))
    .nullable()
    .optional(),
  btw_breakdown: z.array(z.object({ rate: scalar, base: scalar, btw: scalar })).nullable().optional(),
  total: scalar,
  rounding: scalar,
  payment_method: scalar,
});
type Kie = z.infer<typeof kieSchema>;

interface RawLine {
  description: string | number | null;
  qty: string | number | null;
  unit_price: string | number | null;
  total: string | number | null;
  btw_rate: string | number | null;
}
interface RawVat {
  rate: unknown;
  base: unknown;
  vat: unknown;
}

/** Strips code fences / chatter around the JSON object, then parses and shape-checks it. */
function parseKie(raw: string): Kie | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = kieSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Text value of a KIE scalar; `null`, "null", "" and "-" mean "not printed". */
function text(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = normaliseOcrText(String(v));
  return s === '' || s === '-' || s.toLowerCase() === 'null' ? null : s;
}

// ---------------------------------------------------------------------------------------------
// Markdown (the model's "Parse this document to Markdown" answer)

interface MarkdownFacts {
  name: string | null;
  kvk: string | null;
  btw: string | null;
  postcode: string | null;
  date: string | null;
  time: string | null;
  total: string | null;
  rounding: string | null;
  payment: Method | null;
  vat: RawVat[];
  lines: RawLine[];
}

const CARD_RE = /\b(pin|pinnen|maestro|v ?pay|visa|mastercard|debit|debet|credit|creditcard|contactloos|apple ?pay)\b/i;
const CASH_RE = /\b(contant|contanten|kontant|cash)\b/i;
const AMOUNT_RE = /-?\d[\d.,]*-?/g;

function paymentFromText(s: string): Method | null {
  if (CASH_RE.test(s)) return 'cash';
  if (CARD_RE.test(s)) return 'card';
  if (/\b(ideal|cadeaubon|waardebon|tegoed|bon)\b/i.test(s)) return 'other';
  return null;
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function columnOf(header: string[], names: RegExp): number {
  return header.findIndex((h) => names.test(h));
}

function parseMarkdownLines(rows: string[]): RawLine[] {
  const out: RawLine[] = [];
  const headerAt = rows.findIndex((r) => r.includes('|') && /omschrijving|artikel|product/i.test(r));
  if (headerAt < 0) return out;
  const header = cells(rows[headerAt]!);
  const col = {
    description: columnOf(header, /omschrijving|artikel|product/i),
    qty: columnOf(header, /aantal|qty|hoeveel/i),
    unit: columnOf(header, /prijs|stuk|à/i),
    total: columnOf(header, /bedrag|totaal|total/i),
    btw: columnOf(header, /btw|%/i),
  };
  for (const row of rows.slice(headerAt + 1)) {
    if (!row.includes('|')) break;
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(row)) continue;
    const c = cells(row);
    const at = (i: number) => (i >= 0 ? (c[i] ?? null) : null);
    out.push({
      description: at(col.description),
      qty: at(col.qty),
      unit_price: at(col.unit),
      total: at(col.total),
      btw_rate: at(col.btw),
    });
  }
  return out;
}

function parseMarkdown(md: string): MarkdownFacts {
  const rawRows = md.split('\n');
  // table rows lose their pipes for the label/amount matchers
  const rows = rawRows.map((r) => r.replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter((r) => r !== '' && !/^[\s:-]+$/.test(r));
  const facts: MarkdownFacts = {
    name: null,
    kvk: null,
    btw: null,
    postcode: null,
    date: null,
    time: null,
    total: null,
    rounding: null,
    payment: null,
    vat: [],
    lines: parseMarkdownLines(rawRows),
  };
  for (const row of rows) {
    const plain = row.replace(/^#+\s*/, '');
    if (facts.name === null && /\p{L}{3}/u.test(plain) && !/^(kvk|btw|datum|tijd|bon|kassa|tel|omschrijving|\d)/i.test(plain) && !plain.includes('|')) {
      facts.name = plain;
    }
    facts.kvk ??= /kvk(?:[-\s]*(?:nr|nummer|number))?\.?\s*:?\s*(\d[\d .-]*)/i.exec(plain)?.[1]?.trim() ?? null;
    facts.btw ??=
      /(?:btw|vat)[-\s]*(?:id|nr|nummer|number|no)\.?\s*:?\s*(NL[ .]?(?:\d[ .]?){9}B[ .]?\d{2}|NL[0-9A-Za-z.-]+)/i.exec(plain)?.[1] ??
      /\b(NL[ .]?(?:\d[ .]?){9}B[ .]?\d{2})\b/i.exec(plain)?.[1] ??
      null;
    facts.postcode ??= /\b([1-9]\d{3}\s?[A-Z]{2})\b/.exec(plain)?.[1] ?? null;
    facts.date ??= /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/.exec(plain)?.[1] ?? null;
    facts.time ??= /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/.exec(plain)?.[1] ?? null;
    facts.total ??= /^(?:totaal|total)(?:\s+(?:eur|euro|bedrag))?[\s:€]*(-?\d[\d.,]*-?)$/i.exec(plain)?.[1] ?? null;
    facts.rounding ??= /^afronding[\s:€]*(-?\d[\d.,]*-?)$/i.exec(plain)?.[1] ?? null;
    facts.payment ??= /betaald|betaling|teruggave|pinnen|^pin\b|contant|kontant/i.test(plain) ? paymentFromText(plain) : null;
    const vat = /^(?:btw\s*)?(21|9|0)(?:[.,]0+)?\s*%\s*(?:over\s+)?(.*)$/i.exec(plain);
    if (vat) {
      const amounts = vat[2]!.match(AMOUNT_RE) ?? [];
      if (amounts.length >= 2) facts.vat.push({ rate: vat[1], base: amounts[0], vat: amounts[1] });
      else if (amounts.length === 1) facts.vat.push({ rate: vat[1], base: null, vat: amounts[0] });
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------
// Lines

const DEPOSIT_RE = /statiegeld|emballage|leeggoed|\bpand\b/i;
const RETURN_RE = /\bretour|terugbetaling|\bcredit(?:nota)?\b/i;

interface LineResult {
  line: ParsedLine;
  failures: string[];
}

function toLine(raw: RawLine, previousRate: 21 | 9 | 0 | null): LineResult {
  const failures: string[] = [];
  const description = text(raw.description) ?? '';
  if (description === '') failures.push('line_description');
  let qty = parseQty(raw.qty);
  if (qty === undefined || Number(qty) === 0) {
    failures.push('qty_format');
    qty = '1';
  }
  const unitText = text(raw.unit_price);
  let unitPrice = unitText === null ? null : parseCents(unitText);
  if (unitText !== null && unitPrice === null) failures.push('unit_price_format');
  const total = parseCents(raw.total);
  if (total === null) failures.push('line_total_missing');
  const lineTotalCents = total ?? 0;
  let vatRate = parseVatRate(raw.btw_rate);
  let kind: ParsedLine['kind'] = 'item';
  if (DEPOSIT_RE.test(description)) {
    kind = 'deposit';
    vatRate = null;
  } else if (lineTotalCents < 0 && Number(qty) > 0) {
    if (RETURN_RE.test(description) && unitPrice !== null && unitPrice > 0 && lineTotalCents === -divRoundHalfUp(qtyToMilli(qty) * BigInt(unitPrice), 1000n)) {
      qty = `-${qty}`; // "Retour sneakers 1 × 89,95 = -89,95": the printed minus belongs to the quantity
    } else {
      kind = 'discount';
      vatRate ??= previousRate; // a bonus line carries the VAT rate of the item it discounts
      unitPrice ??= lineTotalCents;
    }
  }
  return { line: { description: description || '(onleesbaar)', qty, unitPrice, total: lineTotalCents, vatRate, kind }, failures };
}

// ---------------------------------------------------------------------------------------------
// Draft → §5 checks

/** Unit price implied by a line total when the unit price was not printed (bonus lines, single items). */
function unitFromTotal(total: number, qty: string): number {
  const milli = qtyToMilli(qty);
  return milli < 0n ? divRoundHalfUp(-BigInt(total) * 1000n, -milli) : divRoundHalfUp(BigInt(total) * 1000n, milli);
}

function crfDraft(p: Omit<ParsedReceipt, 'status' | 'failures'>, lineSum: number): Crf {
  const lines: Crf['lines'] = p.lines.map((l, i) => ({
    lineNo: i + 1,
    kind: l.kind,
    sku: null,
    description: l.description.slice(0, 80),
    qty: l.qty,
    unitPrice: l.unitPrice ?? unitFromTotal(l.total, l.qty),
    vatRate: l.vatRate,
    discount: 0,
    total: l.total,
    category: null,
  }));
  const vatSummary = deriveVatSummary(lines);
  return {
    crf: '1',
    receiptId: '01900000-0000-7000-8000-000000000000',
    version: 1,
    state: 'paid',
    // placeholders when unreadable: missing merchant/date/payment are reported by their own checks
    merchant: {
      kvkNumber: p.merchant.kvkNumber ?? '00000000',
      vatNumber: p.merchant.vatNumber,
      name: (p.merchant.name ?? 'onbekend').slice(0, 120),
      locationId: '00000000-0000-0000-0000-000000000000',
      terminalId: '00000000-0000-0000-0000-000000000000',
    },
    createdAt: p.printedAtUtc ?? '1970-01-01T00:00:00Z',
    currency: 'EUR',
    lines,
    vatSummary,
    totals: {
      gross: lineSum,
      net: vatSummary.reduce((s, v) => s + v.net, 0),
      vat: vatSummary.reduce((s, v) => s + v.vat, 0),
      tip: 0,
      rounding: p.rounding,
    },
    payments: [{ method: p.paymentMethod ?? 'other', amount: lineSum + p.rounding }],
    fiscal: { country: 'NL', registerSerial: null, documentNumber: null, extra: {} },
    voidOf: null,
  };
}

function vatRows(rows: RawVat[], failures: string[]): ParsedReceipt['vatBreakdown'] {
  const out: ParsedReceipt['vatBreakdown'] = [];
  for (const r of rows) {
    const rate = parseVatRate(r.rate);
    const vat = parseCents(r.vat);
    const base = r.base === null || r.base === undefined || r.base === '' ? null : parseCents(r.base);
    if (rate === null || vat === null || (r.base !== null && r.base !== undefined && r.base !== '' && base === null)) {
      failures.push('vat_row_unreadable');
      continue;
    }
    out.push({ rate, base, vat });
  }
  return out.sort((a, b) => b.rate - a.rate);
}

function sameVat(a: ParsedReceipt['vatBreakdown'], b: ParsedReceipt['vatBreakdown']): boolean {
  return a.length === b.length && a.every((r, i) => r.rate === b[i]!.rate && r.vat === b[i]!.vat);
}

function parseInner(input: { markdown: string; kie: string }, failures: string[]): ParsedReceipt {
  const md = parseMarkdown(normaliseOcrText(input.markdown));
  const kie = parseKie(input.kie);
  if (kie === null) failures.push('kie_unparseable');

  // merchant
  const name = text(kie?.merchant_name) ?? md.name;
  const kvkRaw = text(kie?.kvk_number) ?? md.kvk;
  const btwRaw = text(kie?.btw_number) ?? md.btw;
  const kvkNumber = normaliseKvk(kvkRaw);
  const vatNumber = normaliseBtwId(btwRaw);
  if (kvkRaw !== null && kvkNumber === null) failures.push('kvk_format');
  if (btwRaw !== null && vatNumber === null) failures.push('btw_id_format');
  const postcode = normalisePostcode(text(kie?.postcode)) ?? normalisePostcode(md.postcode);
  const merchant = { name, kvkNumber, vatNumber, postcode };
  const merchantKey = merchantKeyOf(merchant);
  if (merchantKey === null) failures.push('merchant_missing');

  // date and time
  const date = text(kie?.date) ?? md.date;
  const time = text(kie?.time) ?? md.time;
  const printedAtUtc = date !== null && time !== null ? printedToUtc(date, time) : null;
  if (printedAtUtc === null) failures.push('printed_at');

  // lines
  const kieLines = kie?.lines ?? [];
  const rawLines: RawLine[] =
    kieLines.length > 0
      ? kieLines.map((l) => ({ description: l.description ?? null, qty: l.qty ?? null, unit_price: l.unit_price ?? null, total: l.total ?? null, btw_rate: l.btw_rate ?? null }))
      : md.lines;
  if (rawLines.length === 0) failures.push('no_lines');
  const lines: ParsedLine[] = [];
  let previousRate: 21 | 9 | 0 | null = null;
  for (const raw of rawLines) {
    const res = toLine(raw, previousRate);
    lines.push(res.line);
    failures.push(...res.failures);
    if (res.line.kind === 'item') previousRate = res.line.vatRate;
  }
  const lineSum = lines.reduce((s, l) => s + l.total, 0);

  // payment
  const kiePayment = text(kie?.payment_method);
  const paymentMethod = (kiePayment === null ? null : (paymentFromText(kiePayment) ?? 'other')) ?? md.payment;
  if (paymentMethod === null) failures.push('payment_missing');

  // printed total: exact agreement with the line sum, and between the two model outputs
  const kieTotal = text(kie?.total);
  const kieGross = kieTotal === null ? null : parseCents(kieTotal);
  const mdGross = md.total === null ? null : parseCents(md.total);
  if (kieTotal !== null && kieGross === null) failures.push('gross_format');
  if (kieGross !== null && mdGross !== null && kieGross !== mdGross) failures.push('total_disagree');
  const gross = kieGross ?? mdGross;
  if (gross === null) failures.push('gross_missing');
  else if (gross !== lineSum) failures.push('gross_sum');

  // rounding
  const roundingText = text(kie?.rounding) ?? md.rounding;
  const printedRounding = roundingText === null ? 0 : parseCents(roundingText);
  if (printedRounding === null) failures.push('rounding_format');
  const rounding = printedRounding ?? 0;
  if (Math.abs(rounding) > TOLERANCE) failures.push('rounding_range');
  if (gross !== null) {
    if (rounding !== 0 && rounding !== cashRounding(gross)) failures.push('rounding_rule');
    if (rounding === 0 && paymentMethod === 'cash' && cashRounding(gross) !== 0) failures.push('rounding_missing');
  }

  // BTW per rate: every rate with lines must be printed, and the printed amount must equal the §5 rule exactly
  const kieVat = vatRows((kie?.btw_breakdown ?? []).map((r) => ({ rate: r.rate, base: r.base, vat: r.btw })), failures);
  const mdVat = vatRows(md.vat, failures);
  if (kieVat.length > 0 && mdVat.length > 0 && !sameVat(kieVat, mdVat)) failures.push('vat_source_disagree');
  const vatBreakdown = kieVat.length > 0 ? kieVat : mdVat;
  const rateGross: Record<number, number> = {};
  for (const l of lines) if (l.vatRate !== null) rateGross[l.vatRate] = (rateGross[l.vatRate] ?? 0) + l.total;
  for (const [rateKey, sum] of Object.entries(rateGross)) {
    const rate = Number(rateKey);
    const expected = vatFromGross(sum, rate);
    const rows = vatBreakdown.filter((r) => r.rate === rate);
    if (rows.length === 0) failures.push('vat_missing_rate');
    if (rows.length > 1) failures.push('vat_duplicate_rate');
    const row = rows[0];
    if (!row) continue;
    if (row.vat !== expected.vat) failures.push('vat_mismatch');
    if (row.base !== null && row.base !== expected.net && row.base !== sum) failures.push('vat_base');
  }
  for (const row of vatBreakdown) if (rateGross[row.rate] === undefined) failures.push('vat_extra_rate');

  const parsed: Omit<ParsedReceipt, 'status' | 'failures'> = { merchant, merchantKey, printedAtUtc, lines, gross, rounding, vatBreakdown, paymentMethod };
  if (lines.length > 0) {
    for (const issue of validateCrf(crfDraft(parsed, lineSum), { tolerance: TOLERANCE })) failures.push(issue.code);
  }
  return { ...parsed, status: 'done', failures: [] };
}

/** A printed date this far past the caller's clock is a misread (or a future-dated slip), not a receipt: clock skew and time zones stay inside it. */
export const FUTURE_TOLERANCE_MS = 24 * 3_600_000;

export interface ParseOptions {
  /**
   * The caller's clock. When given, a receipt printed more than {@link FUTURE_TOLERANCE_MS} after it fails the
   * `date_future` check. The parser itself never reads the clock, so without `now` the date is not checked.
   */
  now?: Date;
}

/**
 * Deterministic extraction parser (no LLM): Qianfan's markdown + KIE JSON → a checked receipt.
 * `done` only when the schema and §5 arithmetic checks pass (2-cent tolerance on line arithmetic) AND the printed
 * total and the printed BTW per rate agree exactly with the line sum; otherwise `needs_review` with the names of
 * the failed checks (`date_future`: printed after `opts.now` plus a day). Never throws.
 */
export function parseExtraction(input: { markdown: string; kie: string }, opts: ParseOptions = {}): ParsedReceipt {
  const failures: string[] = [];
  let parsed: ParsedReceipt;
  try {
    parsed = parseInner({ markdown: String(input.markdown ?? ''), kie: String(input.kie ?? '') }, failures);
  } catch {
    failures.push('parser_error');
    parsed = {
      status: 'needs_review',
      failures: [],
      merchant: { name: null, kvkNumber: null, vatNumber: null, postcode: null },
      merchantKey: null,
      printedAtUtc: null,
      lines: [],
      gross: null,
      rounding: 0,
      vatBreakdown: [],
      paymentMethod: null,
    };
  }
  if (opts.now && parsed.printedAtUtc !== null && Date.parse(parsed.printedAtUtc) > opts.now.getTime() + FUTURE_TOLERANCE_MS) failures.push('date_future');
  const unique = [...new Set(failures)];
  return { ...parsed, status: unique.length === 0 ? 'done' : 'needs_review', failures: unique };
}
