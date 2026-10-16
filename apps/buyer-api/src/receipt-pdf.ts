// pdfmake ships no types: every TypeScript program that imports this file must also see our declaration
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./pdfmake.d.ts" />
import pdfmake from 'pdfmake';
import { formatEuro } from '@lr/receipt-nl';
import type { Crf } from '@lr/schema';

// PDF standard fonts: nothing to embed, nothing to download
pdfmake.setFonts({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });

const right = (text: string, bold = false) => ({ text, alignment: 'right', bold });

/** A PDF of one receipt version, in English, with the banner for non-final versions. */
export async function renderReceiptPdf(crf: Crf, opts: { final: boolean }): Promise<Uint8Array> {
  const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(crf.createdAt));
  const doc = {
    info: { title: `Receipt ${crf.merchant.name}`, producer: 'receipts' },
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    content: [
      { text: crf.merchant.name, fontSize: 16, bold: true },
      { text: `KvK ${crf.merchant.kvkNumber}${crf.merchant.vatNumber ? `   VAT ${crf.merchant.vatNumber}` : ''}`, color: '#555555' },
      { text: `${when}   version ${crf.version}`, margin: [0, 4, 0, 0] },
      ...(crf.state === 'presented' ? [{ text: 'Not a final receipt', bold: true, margin: [0, 8, 0, 0] }] : []),
      ...(crf.state === 'void' ? [{ text: 'VOID', bold: true, margin: [0, 8, 0, 0] }] : []),
      {
        table: {
          headerRows: 1,
          widths: ['*', 50, 40, 70],
          body: [
            [{ text: 'Description', bold: true }, right('Qty', true), right('VAT', true), right('Total', true)],
            ...crf.lines.map((l) => [l.description, right(l.qty), right(l.vatRate === null ? '-' : `${l.vatRate}%`), right(formatEuro(l.total))]),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 12, 0, 8],
      },
      {
        table: {
          widths: ['*', 70],
          body: [
            ...crf.vatSummary.map((v) => [`VAT ${v.rate}% on ${formatEuro(v.net)}`, right(formatEuro(v.vat))]),
            ...(crf.totals.tip ? [['Tip', right(formatEuro(crf.totals.tip))]] : []),
            ...(crf.totals.rounding ? [['Rounding', right(formatEuro(crf.totals.rounding))]] : []),
            [{ text: 'Total', bold: true }, right(formatEuro(crf.totals.gross + crf.totals.tip + crf.totals.rounding), true)],
            ...crf.payments.map((p) => [`Paid (${p.method})`, right(formatEuro(p.amount))]),
          ],
        },
        layout: 'noBorders',
      },
      { text: opts.final ? 'Final receipt' : 'Provisional: this receipt may still change', italics: true, margin: [0, 12, 0, 0] },
      { text: `Receipt ${crf.receiptId}`, fontSize: 7, color: '#888888', margin: [0, 8, 0, 0] },
    ],
  };
  return pdfmake.createPdf(doc).getBuffer();
}
