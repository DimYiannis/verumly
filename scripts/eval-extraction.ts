/**
 * `pnpm eval:extraction` — recorded Qianfan outputs → deterministic parser → compared with the truth files.
 * Gate (exit 1): no receipt may reach `done` with a gross or per-rate VAT that differs from the truth.
 * Accuracy per field is reported, not gated.
 */
import { loadCorpus } from './lib/corpus.ts';
import { evaluate, formatReport } from './lib/eval.ts';

const corpus = loadCorpus();
if (corpus.kind === 'mock') console.log('MOCK CORPUS — not a real accuracy measurement');

const report = evaluate(corpus);
if (report.withoutRecording.length > 0) console.log(`No recorded Qianfan output yet for: ${report.withoutRecording.join(', ')}`);
if (report.evaluated.length === 0) {
  console.log('Nothing to evaluate: no <sha256>.qianfan.json next to any truth file.');
} else {
  console.log(`\n${formatReport(report)}\n`);
}

if (report.falseDone.length > 0) {
  for (const r of report.falseDone) console.error(`GATE FAILED: ${r.id} reached done but ${r.falseDone}`);
  process.exitCode = 1;
} else {
  console.log(`GATE OK: zero false done (${report.evaluated.length} receipts evaluated).`);
}
