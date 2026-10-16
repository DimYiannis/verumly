import pdfmake from 'pdfmake';
import { formatEuro } from '@lr/receipt-nl';
import type { Crf } from '@lr/schema';

pdfmake.setFonts({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });

const rows = (crf: Crf) => [
  [{ text: 'Description', bold: true }, { text: 'Qty', bold: true, alignment: 'right' }, { text: 'VAT', bold: true, alignment: 'right' }, { text: 'Total', bold: true, alignment: 'right' }],
  ...crf.lines.map((l) => [l.description, { text: l.qty, alignment: 'right' }, { text: l.vatRate === null ? '-' : `${l.vatRate}%`, alignment: 'right' }, { text: formatEuro(l.total), alignment: 'right' }]),
];

/** A PDF of one receipt version for the merchant archive (merchant data only; there is no buyer data to show). */
export async function receiptPdf(crf: Crf): Promise<Uint8Array> {
  const amsterdam = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Amsterdam' }).format(new Date(crf.createdAt));
  const doc = {
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    content: [
      { text: crf.merchant.name, fontSize: 16, bold: true },
      { text: [`KvK ${crf.merchant.kvkNumber}`, crf.merchant.vatNumber ? `   VAT ${crf.merchant.vatNumber}` : ''].join(''), color: '#555555' },
      { text: `${amsterdam}   version ${crf.version}   ${crf.state}`, margin: [0, 4, 0, 0] },
      ...(crf.state === 'presented' ? [{ text: 'Not a final receipt', bold: true, margin: [0, 8, 0, 0] }] : []),
      ...(crf.state === 'void' ? [{ text: 'VOID', bold: true, margin: [0, 8, 0, 0] }] : []),
      { table: { headerRows: 1, widths: ['*', 50, 40, 70], body: rows(crf) }, layout: 'lightHorizontalLines', margin: [0, 12, 0, 8] },
      {
        table: {
          widths: ['*', 70],
          body: [
            ...crf.vatSummary.map((v) => [`VAT ${v.rate}% on ${formatEuro(v.net)}`, { text: formatEuro(v.vat), alignment: 'right' }]),
            ...(crf.totals.rounding ? [['Rounding', { text: formatEuro(crf.totals.rounding), alignment: 'right' }]] : []),
            [{ text: 'Total', bold: true }, { text: formatEuro(crf.totals.gross + crf.totals.tip + crf.totals.rounding), bold: true, alignment: 'right' }],
            ...crf.payments.map((p) => [`Paid (${p.method})`, { text: formatEuro(p.amount), alignment: 'right' }]),
          ],
        },
        layout: 'noBorders',
      },
      { text: `Receipt ${crf.receiptId}`, fontSize: 7, color: '#888888', margin: [0, 16, 0, 0] },
    ],
  };
  return pdfmake.createPdf(doc).getBuffer();
}
