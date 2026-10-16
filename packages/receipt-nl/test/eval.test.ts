import { describe, expect, it } from 'vitest';
import { parseExtraction, truthPrintedAtUtc } from '../src/index.ts';
import { loadCorpus, readRecorded } from '../../../scripts/lib/corpus.ts';
import { evaluate, formatReport } from '../../../scripts/lib/eval.ts';

const corpus = loadCorpus();
const report = evaluate(corpus);

describe('D. extraction eval on recorded Qianfan outputs', () => {
  it('evaluates every truth file that has a recording', () => {
    console.log(`${corpus.kind === 'mock' ? 'MOCK CORPUS — not a real accuracy measurement\n' : ''}${formatReport(report)}`);
    expect(report.evaluated.length + report.withoutRecording.length).toBe(corpus.entries.length);
  });

  it('GATE: zero false done (no done receipt with a gross or per-rate BTW that differs from the truth)', () => {
    expect(report.falseDone.map((r) => `${r.id}: ${r.falseDone}`)).toEqual([]);
  });

  it('mock: the two planted OCR errors end in needs_review, the other four are done and fully correct', () => {
    if (corpus.kind !== 'mock') return;
    const planted = corpus.entries.filter((e) => e.truth.plantedOcrError).map((e) => e.id).sort();
    expect(planted).toEqual(['mock-horeca-gemengd', 'mock-zonder-btw-id']);
    for (const row of report.evaluated) {
      if (planted.includes(row.id)) {
        expect(row.status, row.id).toBe('needs_review');
      } else {
        expect(row.status, `${row.id}: ${row.failures.join(',')}`).toBe('done');
        expect(Object.values(row.fields).filter((v) => v === false), row.id).toEqual([]);
      }
    }
    const byId = Object.fromEntries(report.evaluated.map((r) => [r.id, r.failures]));
    expect(byId['mock-horeca-gemengd']).toContain('gross_sum');
    expect(byId['mock-zonder-btw-id']).toContain('vat_missing_rate');
  });
});

/**
 * The gate, stress-tested: corrupt every digit of a recorded answer (substitute it with each other digit, or drop it)
 * and require that the parser never says `done` with a gross or per-rate BTW that differs from the truth.
 */
describe('D. gate holds under single-digit OCR corruption', () => {
  const mutants = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      if (!/\d/.test(s[i]!)) continue;
      out.push(s.slice(0, i) + s.slice(i + 1));
      for (const d of '0123456789') if (d !== s[i]) out.push(s.slice(0, i) + d + s.slice(i + 1));
    }
    return out;
  };

  for (const entry of corpus.entries) {
    const rec = readRecorded(entry);
    if (rec === null) continue;
    const t = entry.truth;
    const wrong = (p: ReturnType<typeof parseExtraction>) =>
      p.status === 'done' &&
      (p.gross !== t.gross || p.vatBreakdown.length !== t.vat.length || !t.vat.every((v) => p.vatBreakdown.some((b) => b.rate === v.rate && b.vat === v.vat)));

    it(`${entry.id}: corrupted KIE (markdown intact), corrupted markdown (KIE intact), corrupted KIE alone`, () => {
      const falseDone: string[] = [];
      for (const kie of mutants(rec.kie)) if (wrong(parseExtraction({ markdown: rec.markdown, kie }))) falseDone.push(`kie ${kie.length}`);
      for (const markdown of mutants(rec.markdown)) if (wrong(parseExtraction({ markdown, kie: rec.kie }))) falseDone.push(`markdown ${markdown.length}`);
      for (const kie of mutants(rec.kie)) {
        if (wrong(parseExtraction({ markdown: '', kie }))) falseDone.push(`kie-alone ${kie.length}`);
      }
      expect(falseDone).toEqual([]);
    });
  }

  it('the recorded printedAt agrees with the truth (DST handled on both sides of the October switch)', () => {
    for (const entry of corpus.entries) {
      const rec = readRecorded(entry);
      if (rec !== null) expect(parseExtraction(rec).printedAtUtc).toBe(truthPrintedAtUtc(entry.truth));
    }
  });
});

describe('D. the gate machinery itself', () => {
  it('flags a done receipt whose gross or per-rate BTW differs from the truth, and counts none otherwise', () => {
    const done = report.evaluated.find((r) => r.status === 'done');
    if (!done) return;
    const clean = corpus.entries.find((e) => e.id === done.id)!;
    const g = clean.truth.gross;
    expect(evaluate({ ...corpus, entries: [clean] }).falseDone).toEqual([]);
    const wrongGross = { ...clean, truth: { ...clean.truth, gross: g + 1 } };
    expect(evaluate({ ...corpus, entries: [wrongGross] }).falseDone.map((r) => r.falseDone)).toEqual([`gross ${g} != ${g + 1}`]);
    const wrongVat = { ...clean, truth: { ...clean.truth, vat: clean.truth.vat.map((v) => ({ ...v, vat: v.vat + 1 })) } };
    expect(evaluate({ ...corpus, entries: [wrongVat] }).falseDone.map((r) => r.falseDone)).toEqual(['per-rate BTW differs']);
  });
});
