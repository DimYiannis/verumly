import { z } from 'zod';
import { amsterdamLocalToUtc } from './time.ts';
import { cashRounding, lineTotal, vatFromGross } from './money.ts';

/** `<id>.truth.json` (v2 Appendix A). Amounts are integer cents, copied exactly as printed. Mock files add `mock: true`. */
const vatRate = z.union([z.literal(21), z.literal(9), z.literal(0)]);

export const truthLineSchema = z.object({
  description: z.string(),
  qty: z.string(),
  unitPrice: z.number().int().nullable(),
  vatRate: vatRate.nullable(),
  total: z.number().int(),
  kind: z.enum(['item', 'discount', 'deposit']),
});

export const truthSchema = z.object({
  id: z.string().min(1),
  image: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  mock: z.boolean().optional(),
  merchant: z.object({
    name: z.string().nullable(),
    kvk: z.string().nullable(),
    vatNumber: z.string().nullable(),
    postcode: z.string().nullable(),
  }),
  /** local wall-clock time as printed, `2026-10-01T17:42` (Europe/Amsterdam) */
  printedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  gross: z.number().int(),
  rounding: z.number().int(),
  vat: z.array(z.object({ rate: vatRate, printedBase: z.number().int().nullable(), basis: z.enum(['excl', 'incl']), vat: z.number().int() })),
  payments: z.array(z.object({ method: z.enum(['card', 'cash', 'other']), amount: z.number().int() })),
  lines: z.array(truthLineSchema).nullable(),
  quirks: z.array(z.string()),
  /** mock only: the OCR error planted in the recorded Qianfan output (the receipt must end in needs_review) */
  plantedOcrError: z.string().optional(),
});
export type Truth = z.infer<typeof truthSchema>;

/** `printedAt` of a truth file as ISO UTC (DST-aware). */
export function truthPrintedAtUtc(t: Truth): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t.printedAt);
  return m ? amsterdamLocalToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])) : null;
}

/** A recorded Qianfan answer, `<sha256>.qianfan.json` (v2 Appendix A). */
export const recordedSchema = z.object({ modelRevision: z.string(), markdown: z.string(), kie: z.string() });
export type Recorded = z.infer<typeof recordedSchema>;

/** `known-misfits.json`: one row per (receipt, rule) that receipt-nl is expected NOT to reproduce, with the reason. */
export const knownMisfitsSchema = z.array(z.object({ id: z.string(), rule: z.string(), reason: z.string().min(1) }));

export interface Misfit {
  /** stable rule name; `known-misfits.json` lists `<id>` + `<rule>` pairs */
  rule: string;
  message: string;
}

/**
 * Does receipt-nl reproduce what is printed on this receipt? Checks, to the cent: line sum = gross; per-rate BTW
 * (§5: round per rate total) and its printed base; cash rounding; payments = gross + rounding; line arithmetic.
 * Without `lines`, per-rate gross is rebuilt from the printed bases.
 */
export function checkTruth(t: Truth): Misfit[] {
  const out: Misfit[] = [];
  const add = (rule: string, message: string) => out.push({ rule, message });

  const rateGross: Record<number, number> = {};
  if (t.lines) {
    for (const l of t.lines) if (l.vatRate !== null) rateGross[l.vatRate] = (rateGross[l.vatRate] ?? 0) + l.total;
    const sum = t.lines.reduce((s, l) => s + l.total, 0);
    if (sum !== t.gross) add('gross', `sum(lines)=${sum} != printed gross ${t.gross}`);
    for (const l of t.lines) {
      if (l.unitPrice !== null && lineTotal(l.qty, l.unitPrice, 0) !== l.total) {
        add('line_arith', `"${l.description}": round(${l.qty}×${l.unitPrice})=${lineTotal(l.qty, l.unitPrice, 0)} != ${l.total}`);
      }
    }
  } else {
    for (const v of t.vat) rateGross[v.rate] = v.basis === 'incl' ? (v.printedBase ?? 0) : (v.printedBase ?? 0) + v.vat;
    const sum = Object.values(rateGross).reduce((s, g) => s + g, 0);
    if (sum !== t.gross && !t.quirks.includes('statiegeld')) add('gross', `sum of per-rate gross ${sum} != printed gross ${t.gross}`);
  }

  for (const v of t.vat) {
    const gross = rateGross[v.rate];
    if (gross === undefined) {
      add(`vat:${v.rate}`, `printed BTW ${v.rate}% but no line carries that rate`);
      continue;
    }
    const expected = vatFromGross(gross, v.rate);
    if (expected.vat !== v.vat) add(`vat:${v.rate}`, `rule gives ${expected.vat} on ${gross}, printed ${v.vat}`);
    const expectedBase = v.basis === 'excl' ? expected.net : gross;
    if (v.printedBase !== null && v.printedBase !== expectedBase) add(`vat:${v.rate}`, `${v.basis} base: rule gives ${expectedBase}, printed ${v.printedBase}`);
  }
  for (const rateKey of Object.keys(rateGross)) {
    if (!t.vat.some((v) => v.rate === Number(rateKey))) add(`vat:${rateKey}`, `lines carry ${rateKey}% but no BTW row is printed`);
  }

  const hasCash = t.payments.some((p) => p.method === 'cash');
  const expectedRounding = hasCash ? cashRounding(t.gross) : 0;
  if (t.rounding !== expectedRounding) add('rounding', `printed ${t.rounding}, 5-cent rule gives ${expectedRounding}`);
  const paid = t.payments.reduce((s, p) => s + p.amount, 0);
  if (paid !== t.gross + t.rounding) add('payments', `sum(payments)=${paid} != gross+rounding=${t.gross + t.rounding}`);
  return out;
}

/** Receipt quirks of Appendix A; every one needs a passing receipt in the corpus. */
export const QUIRKS = ['statiegeld', 'bonus', 'weighed', 'cash-rounding', 'return'] as const;
export type Quirk = (typeof QUIRKS)[number];

/** Is the declared quirk visible in the truth data itself? (Unverifiable without `lines` ⇒ taken as declared.) */
export function quirkPresent(t: Truth, quirk: Quirk): boolean {
  if (!t.quirks.includes(quirk)) return false;
  if (quirk === 'cash-rounding') return t.rounding !== 0;
  if (!t.lines) return true;
  switch (quirk) {
    case 'statiegeld':
      return t.lines.some((l) => l.kind === 'deposit');
    case 'bonus':
      return t.lines.some((l) => l.kind === 'discount');
    case 'weighed':
      return t.lines.some((l) => l.qty.includes('.'));
    case 'return':
      return t.lines.some((l) => l.qty.startsWith('-'));
  }
}
