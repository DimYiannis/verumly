// pdfmake ships no types: every TypeScript program that imports this file must also see our declaration
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pdfmake.d.ts" />
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import pdfmake from 'pdfmake';
import { getFormat } from '@lr/compliance/formats';
import { fiscalLabels } from '@lr/fiscal/specs';
import { formatEuro } from '@lr/receipt-nl';
import { defaultReceiptTemplate, type Crf, type ReceiptTemplate, type TemplateBlock } from '@lr/schema';

/**
 * The receipt as a PDF, drawn from the merchant's receipt template (the same blocks, order, alignment, sizes, colours,
 * font and logo as the wallet shows). One renderer for the buyer's download and the merchant archive.
 */

// Roboto (shipped inside pdfmake) covers Latin Extended, Cyrillic and Greek: used when a receipt has text the PDF standard fonts cannot draw
const ROBOTO_DIR = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');

// PDF standard fonts: nothing to embed, nothing to download
pdfmake.setFonts({
  Roboto: { normal: join(ROBOTO_DIR, 'Roboto-Regular.ttf'), bold: join(ROBOTO_DIR, 'Roboto-Medium.ttf'), italics: join(ROBOTO_DIR, 'Roboto-Italic.ttf'), bolditalics: join(ROBOTO_DIR, 'Roboto-MediumItalic.ttf') },
  Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' },
  Times: { normal: 'Times-Roman', bold: 'Times-Bold', italics: 'Times-Italic', bolditalics: 'Times-BoldItalic' },
  Courier: { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' },
});

const FONT = { sans: 'Helvetica', serif: 'Times', mono: 'Courier' } as const;
const SIZE = { sm: 8, md: 10, lg: 13, xl: 18 } as const;
const MARGIN = 26;
/** pdfkit reads PNG and JPEG only; a WebP logo (saved by an older designer) is left out of the PDF. */
const PDF_LOGO_RE = /^data:image\/(png|jpeg);base64,/;
const MUTED = '#6b6b78';

type Node = Record<string, unknown>;

export interface PdfOptions {
  /** wording of the footer line for a receipt that can still change (legacy pre-bills) */
  final?: boolean;
}

const cell = (text: string, extra: Node = {}): Node => ({ text, ...extra });

/** What the standard (WinAnsi) PDF fonts can draw. */
const WIN_ANSI = /^[\u0020-\u007E\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178\n]*$/;

/** The font for a receipt: the template's, unless some text on it needs Roboto (Polish, Czech, Greek, Cyrillic, ...). */
function pickFont(preferred: string, texts: string[]): string {
  return texts.every((t) => WIN_ANSI.test(t)) ? preferred : 'Roboto';
}

/** Amounts: the Dutch style for NL (kept as it was), the country's own number format elsewhere. */
function moneyFor(crf: Crf): (minor: number) => string {
  const f = getFormat(crf.fiscal.country);
  if (!f || (crf.fiscal.country === 'NL' && crf.currency === 'EUR')) return formatEuro;
  const fmt = new Intl.NumberFormat(f.locale, { style: 'currency', currency: crf.currency });
  return (minor) => fmt.format(minor / 100);
}

function pageWidth(template: ReceiptTemplate): number {
  return template.style.paper === 'thermal' ? 226 : 300;
}

/** The pdfmake document definition for a receipt and a template. Pure: tested without rendering. */
export function buildPdfDefinition(crf: Crf, template: ReceiptTemplate | null, opts: PdfOptions = {}): Node {
  const tpl = template ?? defaultReceiptTemplate();
  const { style } = tpl;
  const width = pageWidth(tpl);
  const inner = width - MARGIN * 2;
  const preferred = FONT[style.paper === 'thermal' ? 'mono' : style.font];
  const country = getFormat(crf.fiscal.country);
  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: country?.timezone ?? 'Europe/Amsterdam' }).format(new Date(crf.createdAt));
  const money = moneyFor(crf);
  const names = fiscalLabels(crf.fiscal.country);

  const base = (b: TemplateBlock): Node => ({ alignment: b.align, fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text });

  const block = (b: TemplateBlock): Node | null => {
    const s = base(b);
    switch (b.type) {
      case 'logo':
        return tpl.logo && PDF_LOGO_RE.test(tpl.logo) ? { image: tpl.logo, fit: [140, 56], alignment: b.align, margin: [0, 0, 0, 6] } : null;
      case 'merchantName':
        return { text: crf.merchant.name, ...s, margin: [0, 2, 0, 2] };
      case 'merchantIds':
        return {
          stack: [
            { text: `${country?.idLabels.company ?? 'Company no.'} ${crf.merchant.kvkNumber}${crf.merchant.vatNumber ? `  ·  ${country?.idLabels.vat ?? 'VAT'} ${crf.merchant.vatNumber}` : ''}`, ...s },
            { text: when, ...s },
          ],
          margin: [0, 0, 0, 2],
        };
      case 'text':
        return b.text ? { text: b.text, ...s, margin: [0, 4, 0, 4] } : null;
      case 'divider':
        return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: inner, y2: 0, lineWidth: 0.6, dash: { length: 3, space: 3 }, lineColor: MUTED }], margin: [0, 6, 0, 6] };
      case 'spacer':
        return { text: '', margin: [0, 0, 0, 14] };
      case 'lines':
        return {
          table: {
            widths: ['*', 'auto'],
            body: crf.lines.map((l) => [
              cell(`${l.kind === 'item' && l.qty !== '1' ? `${l.qty} × ` : ''}${l.description}`, { fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text }),
              cell(money(l.total), { alignment: 'right', fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text }),
            ]),
          },
          layout: 'noBorders',
        };
      case 'vatTable': {
        const small = { fontSize: SIZE[b.size], color: b.color ?? style.text };
        return {
          table: {
            widths: ['auto', '*', '*', '*'],
            body: [
              [cell('Rate', { ...small, color: MUTED }), cell('Net', { ...small, color: MUTED, alignment: 'right' }), cell('VAT', { ...small, color: MUTED, alignment: 'right' }), cell('Gross', { ...small, color: MUTED, alignment: 'right' })],
              ...crf.vatSummary.map((v) => [cell(`${v.rate}%`, small), cell(money(v.net), { ...small, alignment: 'right' }), cell(money(v.vat), { ...small, alignment: 'right' }), cell(money(v.gross), { ...small, alignment: 'right' })]),
            ],
          },
          layout: 'noBorders',
          margin: [0, 8, 0, 0],
        };
      }
      case 'totals': {
        const note = { fontSize: SIZE.sm, color: MUTED };
        return {
          table: {
            widths: ['*', 'auto'],
            body: [
              ...(crf.totals.rounding ? [[cell('Rounding', note), cell(money(crf.totals.rounding), { ...note, alignment: 'right' })]] : []),
              ...(crf.totals.tip ? [[cell('Tip', note), cell(money(crf.totals.tip), { ...note, alignment: 'right' })]] : []),
              [cell('Total', { fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text }), cell(money(crf.totals.gross), { alignment: 'right', fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text })],
            ],
          },
          layout: 'noBorders',
          margin: [0, 2, 0, 2],
        };
      }
      case 'payment':
        return crf.payments.length
          ? {
              table: {
                widths: ['*', 'auto'],
                body: crf.payments.map((p) => [cell(p.method === 'card' ? 'Card' : p.method === 'cash' ? 'Cash' : 'Other', { fontSize: SIZE[b.size], color: b.color ?? style.text }), cell(money(p.amount), { alignment: 'right', fontSize: SIZE[b.size], color: b.color ?? style.text })]),
              },
              layout: 'noBorders',
              margin: [0, 8, 0, 0],
            }
          : null;
      case 'fiscal': {
        const rows: Array<[string, string]> = [];
        if (crf.fiscal.documentNumber) rows.push(['Receipt no.', crf.fiscal.documentNumber]);
        if (crf.fiscal.registerSerial) rows.push(['Register', crf.fiscal.registerSerial]);
        for (const [k, v] of Object.entries(crf.fiscal.extra)) rows.push([names[k] ?? (k === 'mode' ? 'Mode' : k), v]);
        return rows.length
          ? { table: { widths: ['auto', '*'], body: rows.map(([k, v]) => [cell(k, { fontSize: SIZE[b.size], color: MUTED }), cell(v, { fontSize: SIZE[b.size], color: b.color ?? style.text, alignment: 'right' })]) }, layout: 'noBorders', margin: [0, 8, 0, 0] }
          : null;
      }
    }
  };

  const texts = [
    crf.merchant.name,
    ...crf.lines.map((l) => l.description),
    ...tpl.blocks.map((b) => b.text ?? ''),
    ...Object.values(crf.fiscal.extra),
    crf.fiscal.documentNumber ?? '',
    crf.fiscal.registerSerial ?? '',
    crf.merchant.kvkNumber,
    country?.idLabels.company ?? '',
    country?.idLabels.vat ?? '',
    ...Object.values(names),
    money(0),
  ];
  const content: Node[] = [];
  if (crf.state === 'void') content.push({ text: 'CANCELLED', alignment: 'center', bold: true, fontSize: 11, color: '#9A3B2E', margin: [0, 0, 0, 8] });
  if (crf.state === 'presented') content.push({ text: 'Not a final receipt', alignment: 'center', bold: true, fontSize: 10, color: '#7A5A10', margin: [0, 0, 0, 8] });
  for (const b of tpl.blocks) {
    if (b.hidden) continue;
    const n = block(b);
    if (n) content.push(n);
  }
  const version = crf.version > 1 || crf.state === 'void' ? `  ·  version ${crf.version}` : '';
  content.push({ text: `${opts.final === false ? 'Provisional: this receipt may still change  ·  ' : ''}Receipt ${crf.receiptId.slice(0, 8)}${version}`, alignment: 'center', fontSize: 6.5, color: MUTED, margin: [0, 14, 0, 0] });

  // The page grows with the content ('auto' height), so the paper colour and border are drawn by one full-width cell
  // that holds everything: its fill and lines stop exactly where the content stops.
  const edge = style.paper === 'plain' ? 0 : style.paper === 'thermal' ? 0.6 : 0.7;
  const paper: Node = {
    table: { widths: ['*'], body: [[{ stack: content, fillColor: style.background, margin: [MARGIN, MARGIN, MARGIN, MARGIN] }]] },
    layout: {
      hLineWidth: () => edge,
      vLineWidth: () => edge,
      hLineColor: () => (style.paper === 'thermal' ? '#bdbdb4' : '#cfcfc6'),
      vLineColor: () => (style.paper === 'thermal' ? '#bdbdb4' : '#cfcfc6'),
      hLineStyle: () => (style.paper === 'thermal' ? { dash: { length: 3, space: 3 } } : null),
      vLineStyle: () => (style.paper === 'thermal' ? { dash: { length: 3, space: 3 } } : null),
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
  };

  return {
    info: { title: `Receipt ${crf.merchant.name}`, producer: 'Verumly' },
    pageSize: { width, height: 'auto' },
    pageMargins: [0, 0, 0, 0],
    defaultStyle: { font: pickFont(preferred, texts), fontSize: 10, color: style.text },
    content: [paper],
  };
}

/** Any pdfmake document definition as PDF bytes, with the standard fonts above (Helvetica, Times, Courier). */
export async function renderPdf(definition: object): Promise<Uint8Array> {
  return pdfmake.createPdf(definition).getBuffer();
}

/** A PDF of one receipt version, in the merchant's design (the default design when none was saved). */
export async function renderReceiptPdf(crf: Crf, template: ReceiptTemplate | null, opts: PdfOptions = {}): Promise<Uint8Array> {
  return renderPdf(buildPdfDefinition(crf, template, opts));
}
