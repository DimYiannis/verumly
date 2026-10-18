import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { defaultReceiptTemplate, type Crf } from '@lr/schema';
import { parseExtraction } from '@lr/receipt-nl';
import { renderPdf, renderReceiptPdf } from '@lr/receipt-pdf';
import { PermanentExtractionError, sniffMime, type Extraction, type Extractor } from '../src/extractor.ts';
import { pageLines, withPdfSupport } from '../src/pdf-extractor.ts';

/** An inner extractor that must never be called, or records what it was given. */
function inner(): Extractor & { got: Uint8Array[] } {
  const got: Uint8Array[] = [];
  return {
    got,
    async extract(bytes) {
      got.push(bytes);
      return { markdown: 'from the model', kie: '{}', modelRevision: 'rev' } satisfies Extraction;
    },
  };
}

const crf = {
  crf: '1',
  receiptId: '0194c6e0-7b2a-7d1e-9c44-5e1f0a3b8c21',
  version: 1,
  state: 'paid',
  merchant: { kvkNumber: '12345678', vatNumber: 'NL123456789B01', name: 'Café Het Plein', locationId: 'l', terminalId: 't' },
  createdAt: '2026-10-17T10:04:00Z',
  currency: 'EUR',
  lines: [
    { lineNo: 1, kind: 'item', sku: null, description: 'Koffie', qty: '2', unitPrice: 340, vatRate: 9, discount: 0, total: 680, category: null },
    { lineNo: 2, kind: 'item', sku: null, description: 'Bier', qty: '1', unitPrice: 389, vatRate: 21, discount: 0, total: 389, category: null },
  ],
  vatSummary: [
    { rate: 21, gross: 389, net: 321, vat: 68 },
    { rate: 9, gross: 680, net: 624, vat: 56 },
  ],
  totals: { gross: 1069, net: 945, vat: 124, tip: 0, rounding: 0 },
  payments: [{ method: 'card', amount: 1069 }],
  fiscal: { country: 'NL', registerSerial: null, documentNumber: null, extra: {} },
  voidOf: null,
} as unknown as Crf;

describe('PDF with a text layer', () => {
  it("this platform's own receipt PDF is read from its text and parses to a finished receipt", async () => {
    const pdf = await renderReceiptPdf(crf, defaultReceiptTemplate());
    const model = inner();
    const read = await withPdfSupport(model).extract(pdf);
    expect(model.got).toHaveLength(0); // no OCR, no model
    expect(read.modelRevision).toBe('pdf-text-1');
    const parsed = parseExtraction(read);
    expect(parsed.failures).toEqual([]);
    expect(parsed).toMatchObject({
      status: 'done',
      gross: 1069,
      paymentMethod: 'card',
      printedAtUtc: '2026-10-17T10:04:00Z',
      merchant: { name: 'Café Het Plein', kvkNumber: '12345678', vatNumber: 'NL123456789B01' },
    });
    expect(parsed.lines.map((l) => [l.description, l.qty, l.total, l.vatRate])).toEqual([
      ['Koffie', '2', 680, 9],
      ['Bier', '1', 389, 21],
    ]);
  });

  it('a Dutch till slip as a PDF ("Koffie 2 x 3,40 6,80", pin, BTW rows) parses too', async () => {
    const rows = ['Supermarkt De Hoek', 'Dorpsstraat 1', '1234 AB Utrecht', 'KvK 12345678', 'BTW NL123456789B01', 'Datum 17-10-2026 14:32', 'Koffie 2 x 3,40 6,80', 'Bier 3,89', 'Totaal 10,69', 'BTW 21% 3,21 0,68', 'BTW 9% 6,24 0,56', 'Betaald met pinnen 10,69'];
    const pdf = await renderPdf({ pageSize: 'A6', defaultStyle: { font: 'Helvetica' }, content: rows.map((text) => ({ text })) });
    const parsed = parseExtraction(await withPdfSupport(inner()).extract(pdf));
    // the slip prints no BTW on the item lines: the rates come from its BTW table (the items that add up to 21% and 9%)
    expect(parsed.failures).toEqual([]);
    expect(parsed.status).toBe('done');
    expect(parsed.gross).toBe(1069);
    expect(parsed.merchant.name).toBe('Supermarkt De Hoek');
    expect(parsed.lines.map((l) => [l.description, l.qty, l.total])).toEqual([
      ['Koffie', '2', 680],
      ['Bier', '1', 389],
    ]);
    expect(parsed.lines.map((l) => l.vatRate)).toEqual([9, 21]);
    expect(parsed.paymentMethod).toBe('card');
    expect(parsed.vatBreakdown.map((v) => [v.rate, v.vat])).toEqual([
      [21, 68],
      [9, 56],
    ]);
  });

  it('groups items by baseline and left to right', () => {
    const item = (str: string, x: number, y: number, width = 30) => ({ str, x, y, width, height: 10, fontSize: 10 }) as never;
    expect(pageLines([item('6,80', 200, 700), item('Koffie', 10, 700.5, 40), item('Totaal', 10, 600, 40), item('10,69', 200, 600)])).toEqual(['Koffie  6,80', 'Totaal  10,69']);
  });
});

/** A white PNG: just enough for pdfmake to embed a page-sized image. */
function whitePng(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 255)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('PDF without text, other files and bad PDFs', () => {
  it('a scan: the first page is drawn as a PNG and read like a photo', async () => {
    const png = `data:image/png;base64,${whitePng(120, 160).toString('base64')}`;
    const pdf = await renderPdf({ pageSize: 'A6', defaultStyle: { font: 'Helvetica' }, content: [{ image: png, width: 200 }] });
    const model = inner();
    const read = await withPdfSupport(model).extract(pdf);
    expect(model.got).toHaveLength(1);
    expect(sniffMime(model.got[0]!)).toBe('image/png');
    expect(read).toMatchObject({ markdown: 'from the model', modelRevision: 'rev+pdf-scan' });
  });

  it('an image goes straight to the wrapped extractor', async () => {
    const model = inner();
    const png = whitePng(4, 4);
    await withPdfSupport(model).extract(new Uint8Array(png));
    expect(model.got).toHaveLength(1);
  });

  it('a damaged PDF is a permanent failure with its own code', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nthis is not a pdf at all');
    await expect(withPdfSupport(inner()).extract(bytes)).rejects.toMatchObject({ code: 'pdf_unreadable' });
    await expect(withPdfSupport(inner()).extract(bytes)).rejects.toBeInstanceOf(PermanentExtractionError);
  });

  it('a PDF with too many pages is refused', async () => {
    const pdf = await renderPdf({ pageSize: 'A6', defaultStyle: { font: 'Helvetica' }, content: Array.from({ length: 6 }, (_, i) => ({ text: `page ${i}`, pageBreak: i === 0 ? undefined : 'before' })) });
    await expect(withPdfSupport(inner()).extract(pdf)).rejects.toMatchObject({ code: 'pdf_too_long' });
  });
});
