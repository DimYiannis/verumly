import { companyIdProblem, getFormat, vatIdProblem } from '@lr/compliance';
import { missingFiscalKeys } from '@lr/fiscal';
import { BTW_ID_RE, crf, KVK_RE, type Crf } from '@lr/schema';
import { checkTransition } from './lifecycle.ts';
import { lineTotal, vatFromGross } from './money.ts';

export interface Issue {
  path: string;
  code: string;
  message: string;
}

export interface ValidateOptions {
  /** cents of slack on sums (extraction uses 2; terminals use 0) */
  tolerance?: number;
  /** country of the organisation (default NL): decides currency, VAT rates, id formats, rounding and the fiscal fields */
  country?: string;
}

const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Derive vatSummary from lines: group by rate, round per rate total (v2 §5). Deposits are excluded. */
export function deriveVatSummary(lines: Crf['lines']): Crf['vatSummary'] {
  const byRate = new Map<number, number>();
  for (const l of lines) {
    if (l.vatRate === null) continue;
    byRate.set(l.vatRate, (byRate.get(l.vatRate) ?? 0) + l.total);
  }
  return [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, gross]) => ({ rate, gross, ...vatFromGross(gross, rate) }));
}

type Add = (path: string, code: string, message: string) => void;

/** What depends on the country: currency, VAT rates, id formats, cash rounding and the fiscal step. */
function countryIssues(r: Crf, country: string, format: NonNullable<ReturnType<typeof getFormat>>, add: Add): void {
  if (r.fiscal.country !== country) add('fiscal.country', 'country_mismatch', `receipt says ${r.fiscal.country}, the organisation is in ${country}`);
  if (r.currency !== format.currency) add('currency', 'currency_mismatch', `${country} receipts are in ${format.currency}, not ${r.currency}`);
  r.lines.forEach((l, i) => {
    if (l.vatRate !== null && !format.vatRates.includes(l.vatRate)) add(`lines.${i}.vatRate`, 'vat_rate_not_allowed', `${l.vatRate}% is not a ${country} rate (${format.vatRates.join(', ')})`);
  });
  // NL keeps its strict formats; every other country uses the pattern from the legal research (none = anything)
  if (country === 'NL') {
    if (!KVK_RE.test(r.merchant.kvkNumber)) add('merchant.kvkNumber', 'company_id', 'KvK number must be 8 digits');
    if (r.merchant.vatNumber !== null && !BTW_ID_RE.test(r.merchant.vatNumber)) add('merchant.vatNumber', 'vat_id', 'BTW-id must look like NL123456789B01');
  } else {
    const c = companyIdProblem(country, r.merchant.kvkNumber);
    if (c) add('merchant.kvkNumber', 'company_id', c);
    const v = r.merchant.vatNumber === null ? null : vatIdProblem(country, r.merchant.vatNumber);
    if (v) add('merchant.vatNumber', 'vat_id', v);
  }
  const step = format.cashRoundingStep;
  if (r.totals.rounding !== 0 && (step === null || Math.abs(r.totals.rounding) * 2 > step)) {
    add('totals.rounding', 'rounding_range', step === null ? `${country} has no cash rounding` : `${country} rounds cash to ${step} minor units: at most ±${Math.floor(step / 2)}`);
  }
  if (r.state === 'fiscalised') {
    if (format.fiscal === 'none') add('state', country === 'NL' ? 'fiscalised_not_allowed_nl' : 'fiscalised_not_allowed', `fiscalised is not used for ${country}`);
    else {
      const missing = missingFiscalKeys(country, r.fiscal.extra);
      if (missing.length) add('fiscal.extra', 'fiscal_fields_missing', `missing ${missing.join(', ')}`);
    }
  }
}

/** Schema check plus every §5 arithmetic rule. Returns [] when valid. */
export function validateCrf(input: unknown, opts: ValidateOptions = {}): Issue[] {
  const tol = opts.tolerance ?? 0;
  const parsed = crf.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: 'schema', message: i.message }));
  }
  const r = parsed.data;
  const issues: Issue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });

  const nums = new Set<number>();
  r.lines.forEach((l, i) => {
    if (nums.has(l.lineNo)) add(`lines.${i}.lineNo`, 'duplicate_line_no', `duplicate lineNo ${l.lineNo}`);
    nums.add(l.lineNo);
    const expected = lineTotal(l.qty, l.unitPrice, l.discount);
    if (!within(l.total, expected, tol)) {
      add(`lines.${i}.total`, 'line_total', `total ${l.total} != round(qty×unitPrice)−discount = ${expected}`);
    }
    if (l.kind === 'discount' && l.total >= 0) add(`lines.${i}.total`, 'discount_sign', 'discount line must have a negative total');
    if (l.kind === 'deposit' && l.vatRate !== null) add(`lines.${i}.vatRate`, 'deposit_vat', 'deposit lines have vatRate null');
    if (l.kind !== 'deposit' && l.vatRate === null) add(`lines.${i}.vatRate`, 'vat_missing', 'non-deposit lines need a vatRate');
  });

  const sum = r.lines.reduce((s, l) => s + l.total, 0);
  if (!within(sum, r.totals.gross, tol)) add('totals.gross', 'gross_sum', `sum(lines.total)=${sum} != totals.gross=${r.totals.gross}`);

  const derived = deriveVatSummary(r.lines);
  const given = new Map(r.vatSummary.map((v) => [v.rate, v]));
  if (given.size !== r.vatSummary.length) add('vatSummary', 'vat_duplicate_rate', 'duplicate rate in vatSummary');
  for (const d of derived) {
    const g = given.get(d.rate);
    if (!g) {
      add('vatSummary', 'vat_missing_rate', `missing rate ${d.rate}`);
      continue;
    }
    if (!within(g.gross, d.gross, tol) || !within(g.vat, d.vat, tol) || !within(g.net, d.net, tol)) {
      add('vatSummary', 'vat_mismatch', `rate ${d.rate}: given ${g.gross}/${g.net}/${g.vat}, derived ${d.gross}/${d.net}/${d.vat}`);
    }
    given.delete(d.rate);
  }
  for (const extra of given.keys()) add('vatSummary', 'vat_extra_rate', `rate ${extra} has no lines`);

  const vatSum = r.vatSummary.reduce((s, v) => s + v.vat, 0);
  const netSum = r.vatSummary.reduce((s, v) => s + v.net, 0);
  if (!within(r.totals.vat, vatSum, tol)) add('totals.vat', 'totals_vat', `totals.vat=${r.totals.vat} != sum(vatSummary.vat)=${vatSum}`);
  if (!within(r.totals.net, netSum, tol)) add('totals.net', 'totals_net', `totals.net=${r.totals.net} != sum(vatSummary.net)=${netSum}`);

  const hasCash = r.payments.some((p) => p.method === 'cash');
  if (r.totals.rounding !== 0 && !hasCash) add('totals.rounding', 'rounding_without_cash', 'rounding requires a cash payment');
  if (r.state === 'paid' || r.state === 'fiscalised') {
    const paid = r.payments.reduce((s, p) => s + p.amount, 0);
    const due = r.totals.gross + r.totals.tip + r.totals.rounding;
    if (!within(paid, due, tol)) add('payments', 'payments_sum', `sum(payments)=${paid} != gross+tip+rounding=${due}`);
  }

  const country = (opts.country ?? 'NL').toUpperCase();
  const format = getFormat(country);
  if (!format) {
    add('fiscal.country', 'unknown_country', `unsupported country ${country}`);
  } else {
    countryIssues(r, country, format, add);
  }
  const t = checkTransition(null, r.state === 'fiscalised' ? 'paid' : r.state, country);
  if (!t.ok && r.version === 1) add('state', t.reason, `a receipt cannot start at ${r.state}`);
  if (r.state === 'void' && r.voidOf === null && r.version === 1) {
    // a void as first version must reference something
    add('voidOf', 'void_of_missing', 'void receipt must reference voidOf');
  }
  return issues;
}
