import { merchantKeyOf, parseExtraction, truthPrintedAtUtc, type ParsedReceipt } from '@lr/receipt-nl';
import { readRecorded, type Corpus } from './corpus.ts';

export const FIELDS = ['merchant key', 'date/time', 'gross', 'BTW per rate', 'payment method', 'line count'] as const;
export type Field = (typeof FIELDS)[number];

export interface EvalRow {
  id: string;
  status: ParsedReceipt['status'];
  failures: string[];
  /** per field: true/false, or null when the truth file has nothing to compare with (e.g. `lines: null`) */
  fields: Record<Field, boolean | null>;
  /** set when the parser said `done` but gross or a per-rate BTW differs from the truth (the gate) */
  falseDone: string | null;
}

export interface EvalReport {
  kind: Corpus['kind'];
  evaluated: EvalRow[];
  /** truth files that have no recorded Qianfan output yet */
  withoutRecording: string[];
  accuracy: Record<Field, { correct: number; total: number }>;
  falseDone: EvalRow[];
}

/** Gross and every printed per-rate BTW amount equal to the truth (same set of rates). */
function grossAndVatMatch(parsed: ParsedReceipt, truth: { gross: number; vat: { rate: number; vat: number }[] }): { gross: boolean; vat: boolean } {
  const vat =
    parsed.vatBreakdown.length === truth.vat.length &&
    truth.vat.every((t) => parsed.vatBreakdown.some((p) => p.rate === t.rate && p.vat === t.vat));
  return { gross: parsed.gross === truth.gross, vat };
}

/** Runs every recorded Qianfan output through the deterministic parser and compares it with the truth. */
export function evaluate(corpus: Corpus): EvalReport {
  const evaluated: EvalRow[] = [];
  const withoutRecording: string[] = [];
  for (const entry of corpus.entries) {
    const recorded = readRecorded(entry);
    if (recorded === null) {
      withoutRecording.push(entry.id);
      continue;
    }
    const t = entry.truth;
    const parsed = parseExtraction(recorded);
    const match = grossAndVatMatch(parsed, t);
    const method = t.payments[0]?.method ?? null;
    const fields: EvalRow['fields'] = {
      'merchant key': parsed.merchantKey === merchantKeyOf({ name: t.merchant.name, kvkNumber: t.merchant.kvk, vatNumber: t.merchant.vatNumber, postcode: t.merchant.postcode }),
      'date/time': parsed.printedAtUtc === truthPrintedAtUtc(t),
      gross: match.gross,
      'BTW per rate': match.vat,
      'payment method': method === null ? null : parsed.paymentMethod === method,
      'line count': t.lines === null ? null : parsed.lines.length === t.lines.length,
    };
    const wrong = [match.gross ? null : `gross ${parsed.gross} != ${t.gross}`, match.vat ? null : 'per-rate BTW differs'].filter((x) => x !== null);
    evaluated.push({
      id: entry.id,
      status: parsed.status,
      failures: parsed.failures,
      fields,
      falseDone: parsed.status === 'done' && wrong.length > 0 ? wrong.join('; ') : null,
    });
  }
  const accuracy = {} as EvalReport['accuracy'];
  for (const f of FIELDS) {
    const rows = evaluated.filter((r) => r.fields[f] !== null);
    accuracy[f] = { correct: rows.filter((r) => r.fields[f] === true).length, total: rows.length };
  }
  return { kind: corpus.kind, evaluated, withoutRecording, accuracy, falseDone: evaluated.filter((r) => r.falseDone !== null) };
}

const pct = (a: { correct: number; total: number }) => (a.total === 0 ? 'n/a' : `${((100 * a.correct) / a.total).toFixed(0)}%`);

/** Markdown tables (also pasted into docs/FINDINGS.md). */
export function formatReport(report: EvalReport): string {
  const label = report.kind === 'mock' ? ' (**MOCK**)' : '';
  const out: string[] = [];
  out.push(`| Field${label} | Correct | Total | Accuracy |`, '|---|---|---|---|');
  for (const f of FIELDS) out.push(`| ${f} | ${report.accuracy[f].correct} | ${report.accuracy[f].total} | ${pct(report.accuracy[f])} |`);
  const done = report.evaluated.filter((r) => r.status === 'done').length;
  out.push('', `Status: ${done} done, ${report.evaluated.length - done} needs_review, ${report.falseDone.length} false done.`, '');
  out.push('| Receipt | Status | Failed checks |', '|---|---|---|');
  for (const r of report.evaluated) out.push(`| ${r.id} | ${r.status} | ${r.failures.join(', ') || '-'} |`);
  return out.join('\n');
}
