/**
 * The mock corpus: 6 synthetic kassabonnen. All amounts are integer cents, typed in BY HAND (never computed here):
 * the printed per-rate BTW follows the v2 §5 rule (round per rate total) and each figure is worked out in the comment
 * above its receipt so it can be checked with a pocket calculator. `receipt-nl` is tested against these numbers.
 *
 * Also builds what Qianfan-OCR would have returned (markdown + KIE JSON string), including two planted OCR errors.
 */
import type { Truth } from '@lr/receipt-nl';

export interface MockLine {
  description: string;
  /** CRF decimal string; negative for returns; ≠ integer for weighed items */
  qty: string;
  unitPrice: number | null;
  vatRate: 21 | 9 | 0 | null;
  total: number;
  kind: 'item' | 'discount' | 'deposit';
}

export interface MockReceipt {
  id: string;
  merchant: { name: string; street: string; postcode: string; city: string; kvk: string; vatNumber: string | null };
  printedAt: string;
  bonNumber: string;
  lines: MockLine[];
  gross: number;
  rounding: number;
  vat: { rate: 21 | 9 | 0; printedBase: number; basis: 'excl' | 'incl'; vat: number }[];
  payment: { method: 'card' | 'cash'; amount: number };
  quirks: string[];
  /** how the BTW block is laid out on paper and therefore in the OCR markdown */
  vatLayout: 'table' | 'lines';
  /** KIE answer wrapped in a ```json fence, as chat models often do */
  kieFenced: boolean;
  planted?: 'digit-misread-total' | 'missing-btw-line';
}

const item = (description: string, qty: string, unitPrice: number, vatRate: 21 | 9, total: number): MockLine => ({ description, qty, unitPrice, vatRate, total, kind: 'item' });

export const MOCK_RECEIPTS: MockReceipt[] = [
  // 1. Horeca, mixed 9% / 21%. PLANTED: OCR read the total 43,80 as 48,80.
  //   9%:  Koffie 2×3,40=6,80 + Appeltaart 4,50 + Tosti 6,90 = 18,20   vat = 1820×9/109  = 150,28 → 150 ; net 1670
  //   21%: Bier 3×4,20=12,60 + Wijn 2×6,50=13,00           = 25,60   vat = 2560×21/121 = 444,30 → 444 ; net 2116
  //   gross 18,20 + 25,60 = 43,80, paid by card
  {
    id: 'mock-horeca-gemengd',
    merchant: { name: 'Café Het Plein', street: 'Spuistraat 12', postcode: '1012 AB', city: 'Amsterdam', kvk: '34567801', vatNumber: 'NL123456782B01' },
    printedAt: '2026-10-10T20:47',
    bonNumber: '004512',
    lines: [
      item('Koffie', '2', 340, 9, 680),
      item('Appeltaart', '1', 450, 9, 450),
      item('Tosti ham kaas', '1', 690, 9, 690),
      item('Bier 0,3', '3', 420, 21, 1260),
      item('Wijn rood', '2', 650, 21, 1300),
    ],
    gross: 4380,
    rounding: 0,
    vat: [
      { rate: 9, printedBase: 1670, basis: 'excl', vat: 150 },
      { rate: 21, printedBase: 2116, basis: 'excl', vat: 444 },
    ],
    payment: { method: 'card', amount: 4380 },
    quirks: [],
    vatLayout: 'table',
    kieFenced: false,
    planted: 'digit-misread-total',
  },
  // 2. Supermarket with statiegeld (outside BTW) and a bonus line (carries the rate of the item it discounts).
  //   9%:  melk 1,29 + brood 2,49 + koffie 5,99 − bonus 1,50 = 8,27   vat = 827×9/109  = 68,28 → 68 ; net 759
  //   21%: cola 2×1,89=3,78 + chips 2,19 + wasmiddel 4,99    = 10,96  vat = 1096×21/121 = 190,21 → 190 ; net 906
  //   statiegeld 2×0,25 = 0,50 (no BTW row);  gross 8,27 + 10,96 + 0,50 = 19,73, card
  {
    id: 'mock-supermarkt-statiegeld-bonus',
    merchant: { name: 'Supermarkt De Hoek', street: 'Kerkstraat 45', postcode: '3511 KP', city: 'Utrecht', kvk: '27654321', vatNumber: 'NL987654329B01' },
    printedAt: '2026-10-16T11:03',
    bonNumber: '118204',
    lines: [
      item('Halfvolle melk 1L', '1', 129, 9, 129),
      item('Volkoren brood', '1', 249, 9, 249),
      item('Pak koffie 500g', '1', 599, 9, 599),
      { description: 'BONUS Pak koffie', qty: '1', unitPrice: null, vatRate: 9, total: -150, kind: 'discount' },
      item('Cola 1,5L', '2', 189, 21, 378),
      item('Chips paprika', '1', 219, 21, 219),
      item('Wasmiddel', '1', 499, 21, 499),
      { description: 'Statiegeld fles', qty: '2', unitPrice: 25, vatRate: null, total: 50, kind: 'deposit' },
    ],
    gross: 1973,
    rounding: 0,
    vat: [
      { rate: 9, printedBase: 759, basis: 'excl', vat: 68 },
      { rate: 21, printedBase: 906, basis: 'excl', vat: 190 },
    ],
    payment: { method: 'card', amount: 1973 },
    quirks: ['statiegeld', 'bonus'],
    vatLayout: 'lines',
    kieFenced: true,
  },
  // 3. Weighed items (qty in kg, 3 decimals); this kassabon prints BTW bases INCLUDING btw.
  //   Kaas 0,412 kg × 14,90 = 6,1388 → 6,14 ; Boerenkaas 0,287 × 18,50 = 5,3095 → 5,31 ;
  //   Serranoham 0,350 × 7,10 = 2,485 → 2,49 (tie rounds up) ; Wijn wit 8,95 (21%)
  //   9%:  6,14 + 5,31 + 2,49 = 13,94   vat = 1394×9/109  = 115,10 → 115
  //   21%: 8,95                         vat =  895×21/121 = 155,33 → 155
  //   gross 13,94 + 8,95 = 22,89, card
  {
    id: 'mock-weegschaal',
    merchant: { name: 'Kaashandel Van Dam', street: 'Markt 7', postcode: '2611 GP', city: 'Delft', kvk: '41234567', vatNumber: 'NL234567891B01' },
    printedAt: '2026-10-14T09:35',
    bonNumber: '000871',
    lines: [
      item('Kaas jong belegen', '0.412', 1490, 9, 614),
      item('Boerenkaas oud', '0.287', 1850, 9, 531),
      item('Serranoham', '0.35', 710, 9, 249),
      item('Wijn wit fles', '1', 895, 21, 895),
    ],
    gross: 2289,
    rounding: 0,
    vat: [
      { rate: 9, printedBase: 1394, basis: 'incl', vat: 115 },
      { rate: 21, printedBase: 895, basis: 'incl', vat: 155 },
    ],
    payment: { method: 'card', amount: 2289 },
    quirks: ['weighed'],
    vatLayout: 'lines',
    kieFenced: false,
  },
  // 4. Cash with 5-cent rounding (printed on the DST-end day, after the switch back to CET).
  //   Brood 3,45 + Croissant 3×1,35=4,05 + Boterkoek 4,87 = 12,37 (all 9%)   vat = 1237×9/109 = 102,14 → 102 ; net 1135
  //   12,37 rounds to 12,35: rounding −0,02; paid 12,35 cash
  {
    id: 'mock-contant-afronding',
    merchant: { name: 'Bakkerij Gouden Korst', street: 'Dorpsstraat 3', postcode: '3811 AB', city: 'Amersfoort', kvk: '52345671', vatNumber: 'NL345678912B01' },
    printedAt: '2026-10-25T08:10',
    bonNumber: '030115',
    lines: [item('Volkoren brood', '1', 345, 9, 345), item('Croissant', '3', 135, 9, 405), item('Boterkoek', '1', 487, 9, 487)],
    gross: 1237,
    rounding: -2,
    vat: [{ rate: 9, printedBase: 1135, basis: 'excl', vat: 102 }],
    payment: { method: 'cash', amount: 1235 },
    quirks: ['cash-rounding'],
    vatLayout: 'table',
    kieFenced: true,
  },
  // 5. A return (negative quantity), amount over 1.000 euro to exercise the thousands separator.
  //   Koptelefoon −1 × 1.249,00 = −1.249,00 (21%)   vat = 124900×21/121 = 21676,86 → 21677, mirrored → −216,77 ; net −1.032,23
  {
    id: 'mock-retour',
    merchant: { name: 'Elektro Mulder', street: 'Industrieweg 14', postcode: '5611 AB', city: 'Eindhoven', kvk: '63456712', vatNumber: 'NL456789123B01' },
    printedAt: '2026-10-13T15:20',
    bonNumber: '009943',
    lines: [{ description: 'Retour Koptelefoon ANC', qty: '-1', unitPrice: 124900, vatRate: 21, total: -124900, kind: 'item' }],
    gross: -124900,
    rounding: 0,
    vat: [{ rate: 21, printedBase: -103223, basis: 'excl', vat: -21677 }],
    payment: { method: 'card', amount: -124900 },
    quirks: ['return'],
    vatLayout: 'table',
    kieFenced: false,
  },
  // 6. No BTW-id printed (KvK only), paid cash (11,90 is a multiple of 5: no rounding). PLANTED: the OCR lost the 9% BTW row.
  //   9%:  Friet groot 3,50 + Frikandel speciaal 2,80 + Kroket 2,40 = 8,70   vat = 870×9/109  = 71,83 → 72 ; net 798
  //   21%: Bier flesje 3,20                                                  vat = 320×21/121 = 55,54 → 56 ; net 264
  //   gross 8,70 + 3,20 = 11,90
  {
    id: 'mock-zonder-btw-id',
    merchant: { name: 'Snackbar De Frietzak', street: 'Stationsweg 21', postcode: '2312 AB', city: 'Leiden', kvk: '74567123', vatNumber: null },
    printedAt: '2026-10-17T18:25',
    bonNumber: '002260',
    lines: [item('Friet groot', '1', 350, 9, 350), item('Frikandel speciaal', '1', 280, 9, 280), item('Kroket', '1', 240, 9, 240), item('Bier flesje', '1', 320, 21, 320)],
    gross: 1190,
    rounding: 0,
    vat: [
      { rate: 9, printedBase: 798, basis: 'excl', vat: 72 },
      { rate: 21, printedBase: 264, basis: 'excl', vat: 56 },
    ],
    payment: { method: 'cash', amount: 1190 },
    quirks: [],
    vatLayout: 'lines',
    kieFenced: false,
    planted: 'missing-btw-line',
  },
];

/** `1.234,56` style, always two decimals, minus sign in front. */
export function dutch(cents: number): string {
  const abs = Math.abs(cents);
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+$)/g, '.');
  return `${cents < 0 ? '-' : ''}${euros},${String(abs % 100).padStart(2, '0')}`;
}

/** Quantity as printed: weighed items in kg with a decimal comma. */
export function printedQty(qty: string): string {
  return qty.includes('.') ? `${qty.replace('.', ',').padEnd(5, '0')} kg` : qty;
}

export function printedDate(r: MockReceipt): { date: string; time: string } {
  const [d, t] = r.printedAt.split('T');
  const [y, m, day] = d!.split('-');
  return { date: `${day}-${m}-${y}`, time: t! };
}

export interface PrintedRow {
  description: string;
  qty: string;
  unit: string;
  total: string;
  rate: string;
}

/** What is on the paper, row by row. Shared by the HTML template and the simulated OCR. */
export interface Printed {
  header: string[];
  meta: string[];
  rows: PrintedRow[];
  totals: { label: string; amount: string }[];
  vatHeader: string[];
  vatRows: string[][];
  footer: string;
}

export function printedModel(r: MockReceipt): Printed {
  const { date, time } = printedDate(r);
  const header = [r.merchant.name.toUpperCase(), r.merchant.street, `${r.merchant.postcode} ${r.merchant.city}`, `KvK ${r.merchant.kvk}`];
  if (r.merchant.vatNumber) header.push(`BTW-id ${r.merchant.vatNumber}`);
  const totals = [{ label: 'TOTAAL EUR', amount: dutch(r.gross) }];
  if (r.rounding !== 0) {
    totals.push({ label: 'Afronding', amount: dutch(r.rounding) });
    totals.push({ label: 'Te betalen', amount: dutch(r.gross + r.rounding) });
  }
  totals.push({ label: r.payment.method === 'cash' ? 'Contant' : 'Betaald met PIN', amount: dutch(r.payment.amount) });
  if (r.payment.method === 'card' && r.payment.amount < 0) totals[totals.length - 1] = { label: 'Teruggave PIN', amount: dutch(r.payment.amount) };
  const incl = r.vat.some((v) => v.basis === 'incl');
  return {
    header,
    meta: [`Datum ${date} Tijd ${time}`, `Bon ${r.bonNumber} Kassa 02`],
    rows: r.lines.map((l) => ({
      description: l.description,
      qty: printedQty(l.qty),
      unit: l.unitPrice === null ? '' : dutch(l.unitPrice),
      total: dutch(l.total),
      // a bonus line prints no rate: the BTW follows the item it discounts
      rate: l.vatRate === null || l.kind === 'discount' ? '' : `${l.vatRate}%`,
    })),
    totals,
    vatHeader: incl ? ['BTW %', 'Totaal', 'BTW'] : ['BTW %', 'Over', 'BTW'],
    vatRows: r.vat.map((v) => [`${v.rate}%`, dutch(v.printedBase), dutch(v.vat)]),
    footer: 'Bedankt voor uw bezoek!',
  };
}

export interface QianfanOutput {
  modelRevision: 'mock';
  markdown: string;
  kie: string;
}

/**
 * What Qianfan-OCR would plausibly return for this kassabon. The planted errors are applied to the OCR text itself
 * (both the markdown and the KIE answer), exactly as a misreading would show up in both.
 */
export function simulateQianfan(r: MockReceipt): QianfanOutput {
  const p = printedModel(r);
  const misread = r.planted === 'digit-misread-total';
  // 43,80 → 48,80: the 3 in the tens position was read as an 8
  const totalText = misread ? p.totals[0]!.amount.replace('43,80', '48,80') : p.totals[0]!.amount;
  const totals = p.totals.map((t, i) => (i === 0 ? { ...t, amount: totalText } : t));
  const vatRows = r.planted === 'missing-btw-line' ? p.vatRows.filter((row) => row[0] !== '9%') : p.vatRows;
  const { date, time } = printedDate(r);

  const md: string[] = [`# ${p.header[0]}`, '', ...p.header.slice(1), '', ...p.meta, ''];
  md.push('| Omschrijving | Aantal | Prijs | Bedrag | BTW |', '|---|---|---|---|---|');
  for (const row of p.rows) md.push(`| ${row.description} | ${row.qty} | ${row.unit} | ${row.total} | ${row.rate} |`);
  md.push('');
  for (const t of totals) md.push(`${t.label} ${t.amount}`);
  md.push('');
  if (r.vatLayout === 'table') {
    md.push(`| ${p.vatHeader.join(' | ')} |`, '|---|---|---|');
    for (const row of vatRows) md.push(`| ${row.join(' | ')} |`);
  } else {
    for (const row of vatRows) md.push(`BTW ${row[0]} ${p.vatHeader[1] === 'Over' ? 'over ' : 'totaal '}${row[1]} ${row[2]}`);
  }
  md.push('', p.footer);

  const kie = {
    merchant_name: r.merchant.name,
    kvk_number: r.merchant.kvk,
    btw_number: r.merchant.vatNumber,
    postcode: r.merchant.postcode,
    date,
    time,
    lines: p.rows.map((row) => ({
      description: row.description,
      qty: row.qty.replace(' kg', ''),
      unit_price: row.unit === '' ? null : row.unit,
      total: row.total,
      btw_rate: row.rate === '' ? null : row.rate,
    })),
    btw_breakdown: vatRows.map((row) => ({ rate: row[0], base: row[1], btw: row[2] })),
    total: totalText,
    rounding: r.rounding === 0 ? null : dutch(r.rounding),
    payment_method: r.payment.method === 'cash' ? 'Contant' : 'PIN',
  };
  const json = JSON.stringify(kie, null, 2);
  return { modelRevision: 'mock', markdown: md.join('\n'), kie: r.kieFenced ? `\`\`\`json\n${json}\n\`\`\`` : json };
}

/** `<id>.truth.json` content for a mock receipt (v2 Appendix A + `mock: true`). */
export function mockTruth(r: MockReceipt, sha256: string): Truth {
  return {
    id: r.id,
    image: `${r.id}.png`,
    sha256,
    mock: true,
    merchant: { name: r.merchant.name, kvk: r.merchant.kvk, vatNumber: r.merchant.vatNumber, postcode: r.merchant.postcode },
    printedAt: r.printedAt,
    gross: r.gross,
    rounding: r.rounding,
    vat: r.vat,
    payments: [{ method: r.payment.method, amount: r.payment.amount }],
    lines: r.lines,
    quirks: r.quirks,
    ...(r.planted ? { plantedOcrError: r.planted } : {}),
  };
}
