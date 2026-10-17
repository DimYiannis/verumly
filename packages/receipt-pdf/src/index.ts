// pdfmake ships no types: every TypeScript program that imports this file must also see our declaration
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pdfmake.d.ts" />
import pdfmake from 'pdfmake';
import { formatEuro } from '@lr/receipt-nl';
import { defaultReceiptTemplate, type Crf, type ReceiptTemplate, type TemplateBlock } from '@lr/schema';

/**
 * The receipt as a PDF, drawn from the merchant's receipt template (the same blocks, order, alignment, sizes, colours,
 * font and logo as the wallet shows). One renderer for the buyer's download and the merchant archive.
 */

// PDF standard fonts: nothing to embed, nothing to download
pdfmake.setFonts({
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

function pageWidth(template: ReceiptTemplate): number {
  return template.style.paper === 'thermal' ? 226 : 300;
}

/** The pdfmake document definition for a receipt and a template. Pure: tested without rendering. */
export function buildPdfDefinition(crf: Crf, template: ReceiptTemplate | null, opts: PdfOptions = {}): Node {
  const tpl = template ?? defaultReceiptTemplate();
  const { style } = tpl;
  const width = pageWidth(tpl);
  const inner = width - MARGIN * 2;
  const font = FONT[style.paper === 'thermal' ? 'mono' : style.font];
  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(crf.createdAt));

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
            { text: `${crf.fiscal.country === 'NL' ? 'KvK' : 'Company no.'} ${crf.merchant.kvkNumber}${crf.merchant.vatNumber ? `  ·  VAT ${crf.merchant.vatNumber}` : ''}`, ...s },
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
              cell(formatEuro(l.total), { alignment: 'right', fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text }),
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
              ...crf.vatSummary.map((v) => [cell(`${v.rate}%`, small), cell(formatEuro(v.net), { ...small, alignment: 'right' }), cell(formatEuro(v.vat), { ...small, alignment: 'right' }), cell(formatEuro(v.gross), { ...small, alignment: 'right' })]),
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
              ...(crf.totals.rounding ? [[cell('Rounding', note), cell(formatEuro(crf.totals.rounding), { ...note, alignment: 'right' })]] : []),
              ...(crf.totals.tip ? [[cell('Tip', note), cell(formatEuro(crf.totals.tip), { ...note, alignment: 'right' })]] : []),
              [cell('Total', { fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text }), cell(formatEuro(crf.totals.gross), { alignment: 'right', fontSize: SIZE[b.size], bold: b.bold, color: b.color ?? style.text })],
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
                body: crf.payments.map((p) => [cell(p.method === 'card' ? 'Card' : p.method === 'cash' ? 'Cash' : 'Other', { fontSize: SIZE[b.size], color: b.color ?? style.text }), cell(formatEuro(p.amount), { alignment: 'right', fontSize: SIZE[b.size], color: b.color ?? style.text })]),
              },
              layout: 'noBorders',
              margin: [0, 8, 0, 0],
            }
          : null;
      case 'fiscal': {
        const rows: Array<[string, string]> = [];
        if (crf.fiscal.documentNumber) rows.push(['Receipt no.', crf.fiscal.documentNumber]);
        if (crf.fiscal.registerSerial) rows.push(['Register', crf.fiscal.registerSerial]);
        for (const [k, v] of Object.entries(crf.fiscal.extra)) rows.push([k, v]);
        return rows.length
          ? { table: { widths: ['auto', '*'], body: rows.map(([k, v]) => [cell(k, { fontSize: SIZE[b.size], color: MUTED }), cell(v, { fontSize: SIZE[b.size], color: b.color ?? style.text, alignment: 'right' })]) }, layout: 'noBorders', margin: [0, 8, 0, 0] }
          : null;
      }
    }
  };

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
    info: { title: `Receipt ${crf.merchant.name}`, producer: 'bonnen' },
    pageSize: { width, height: 'auto' },
    pageMargins: [0, 0, 0, 0],
    defaultStyle: { font, fontSize: 10, color: style.text },
    content: [paper],
  };
}

/** A PDF of one receipt version, in the merchant's design (the default design when none was saved). */
export async function renderReceiptPdf(crf: Crf, template: ReceiptTemplate | null, opts: PdfOptions = {}): Promise<Uint8Array> {
  return pdfmake.createPdf(buildPdfDefinition(crf, template, opts)).getBuffer();
}
