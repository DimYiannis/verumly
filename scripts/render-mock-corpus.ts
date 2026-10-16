/**
 * Regenerates fixtures/receipts-nl/mock/: for each mock kassabon an HTML template is screenshotted to
 * `<id>.png` (Playwright/Chromium, fixed viewport and scale), then `<id>.truth.json` and
 * `<sha256-of-png>.qianfan.json` are written. Same machine + same fonts ⇒ byte-identical output.
 *
 *   node scripts/render-mock-corpus.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { MOCK_RECEIPTS, mockTruth, printedModel, simulateQianfan, type MockReceipt } from './lib/mock-receipts.ts';

const MOCK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'receipts-nl', 'mock');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function kassabonHtml(r: MockReceipt): string {
  const p = printedModel(r);
  const rows = p.rows
    .map(
      (row) =>
        `<tr><td class="d">${esc(row.description)}</td><td class="n">${esc(row.qty)}</td><td class="n">${esc(row.unit)}</td><td class="n">${esc(row.total)}</td><td class="n">${esc(row.rate)}</td></tr>`,
    )
    .join('');
  const totals = p.totals.map((t, i) => `<div class="tot${i === 0 ? ' big' : ''}"><span>${esc(t.label)}</span><span>${esc(t.amount)}</span></div>`).join('');
  const vat = p.vatRows.map((row) => `<tr><td>${row.map(esc).join('</td><td class="n">')}</td></tr>`).join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#d9d9d9}
  body{padding:28px;width:420px}
  #bon{width:384px;box-sizing:border-box;padding:22px 18px 26px;background:#fdfcf8;color:#1a1a1a;
       font:13px/1.35 "Courier New",Courier,monospace;-webkit-font-smoothing:antialiased}
  .c{text-align:center}.h1{font-weight:bold;font-size:16px;letter-spacing:1px}
  hr{border:0;border-top:1px dashed #555;margin:9px 0}
  table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}
  td.d{width:44%}td.n{text-align:right;white-space:nowrap;padding-left:4px}
  .tot{display:flex;justify-content:space-between}.big{font-weight:bold;font-size:15px}
  th{font-weight:normal;text-align:left;border-bottom:1px solid #555}th.n{text-align:right}
  </style></head><body><div id="bon">
  <div class="c"><div class="h1">${esc(p.header[0]!)}</div>${p.header.slice(1).map((h) => `<div>${esc(h)}</div>`).join('')}</div>
  <hr>${p.meta.map((m) => `<div>${esc(m)}</div>`).join('')}<hr>
  <table><tr><th>Omschrijving</th><th class="n">Aantal</th><th class="n">Prijs</th><th class="n">Bedrag</th><th class="n">BTW</th></tr>${rows}</table>
  <hr>${totals}<hr>
  <table><tr><th>${esc(p.vatHeader[0]!)}</th><th class="n">${esc(p.vatHeader[1]!)}</th><th class="n">${esc(p.vatHeader[2]!)}</th></tr>${vat}</table>
  <hr><div class="c">${esc(p.footer)}</div></div></body></html>`;
}

mkdirSync(MOCK_DIR, { recursive: true });
for (const f of readdirSync(MOCK_DIR)) {
  if (/\.(png|truth\.json|qianfan\.json)$/.test(f)) rmSync(join(MOCK_DIR, f));
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 });
  for (const r of MOCK_RECEIPTS) {
    await page.setContent(kassabonHtml(r), { waitUntil: 'load' });
    const png = await page.locator('#bon').screenshot({ type: 'png', animations: 'disabled' });
    const sha256 = createHash('sha256').update(png).digest('hex');
    writeFileSync(join(MOCK_DIR, `${r.id}.png`), png);
    writeFileSync(join(MOCK_DIR, `${r.id}.truth.json`), `${JSON.stringify(mockTruth(r, sha256), null, 2)}\n`);
    writeFileSync(join(MOCK_DIR, `${sha256}.qianfan.json`), `${JSON.stringify(simulateQianfan(r), null, 2)}\n`);
    console.log(`${r.id}  ${sha256.slice(0, 12)}…${r.planted ? `  (planted: ${r.planted})` : ''}`);
  }
} finally {
  await browser.close();
}
