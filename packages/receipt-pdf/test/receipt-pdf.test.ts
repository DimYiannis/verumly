import { describe, expect, it } from 'vitest';
import { defaultReceiptTemplate, type Crf } from '@lr/schema';
import { buildPdfDefinition, renderReceiptPdf } from '../src/index.ts';

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

const texts = (def: Record<string, unknown>): string => JSON.stringify(def.content);
/** the blocks, inside the paper cell */
const stack = (def: unknown): Array<Record<string, unknown>> => ((def as { content: Array<{ table: { body: Array<Array<{ stack: Array<Record<string, unknown>> }>> } }> }).content[0]!.table.body[0]![0]!.stack);

describe('buildPdfDefinition follows the template', () => {
  it('draws the blocks in the template order and skips hidden ones', () => {
    const tpl = defaultReceiptTemplate();
    const order = (d: Record<string, unknown>) => stack(d).map((n) => JSON.stringify(n).slice(0, 60));
    const normal = order(buildPdfDefinition(crf, tpl));
    const payment = tpl.blocks.find((b) => b.type === 'payment')!;
    payment.hidden = true;
    expect(texts(buildPdfDefinition(crf, tpl))).not.toContain('"Card"');
    expect(texts(buildPdfDefinition(crf, defaultReceiptTemplate()))).toContain('"Card"');
    // moving totals to the top changes the order
    const moved = defaultReceiptTemplate();
    const totals = moved.blocks.splice(moved.blocks.findIndex((b) => b.type === 'totals'), 1)[0]!;
    moved.blocks.unshift(totals);
    expect(order(buildPdfDefinition(crf, moved))).not.toEqual(normal);
  });

  it('uses the style: font, colours, paper width and the text block', () => {
    const tpl = defaultReceiptTemplate();
    tpl.style.font = 'serif';
    tpl.style.text = '#112233';
    tpl.style.background = '#FFF8E7';
    tpl.blocks.find((b) => b.type === 'text')!.text = 'Dankjewel, tot snel!';
    const def = buildPdfDefinition(crf, tpl) as { defaultStyle: { font: string; color: string }; pageSize: { width: number }; content: unknown[] };
    expect(def.defaultStyle).toMatchObject({ font: 'Times', color: '#112233' });
    expect(def.pageSize.width).toBe(300);
    expect(texts(def as never)).toContain('Dankjewel, tot snel!');
    const thermal = defaultReceiptTemplate();
    thermal.style.paper = 'thermal';
    const t = buildPdfDefinition(crf, thermal) as { defaultStyle: { font: string }; pageSize: { width: number } };
    expect(t.pageSize.width).toBe(226);
    expect(t.defaultStyle.font).toBe('Courier');
  });

  it('block alignment, size, bold and colour reach the text', () => {
    const tpl = defaultReceiptTemplate();
    const name = tpl.blocks.find((b) => b.type === 'merchantName')!;
    Object.assign(name, { align: 'right', size: 'lg', bold: true, color: '#AA3300' });
    const node = stack(buildPdfDefinition(crf, tpl)).find((n) => n.text === 'Café Het Plein');
    expect(node).toMatchObject({ alignment: 'right', fontSize: 13, bold: true, color: '#AA3300' });
  });

  it('prints a PNG or JPEG logo and leaves a WebP one out', () => {
    const png = defaultReceiptTemplate();
    png.logo = 'data:image/png;base64,iVBORw0KGgo=';
    expect(texts(buildPdfDefinition(crf, png))).toContain('"image"');
    const webp = defaultReceiptTemplate();
    webp.logo = 'data:image/webp;base64,UklGRg==';
    expect(texts(buildPdfDefinition(crf, webp))).not.toContain('"image"');
  });

  it('marks a cancelled receipt and falls back to the default design', () => {
    const voided = { ...crf, state: 'void', version: 2 } as Crf;
    expect(texts(buildPdfDefinition(voided, null))).toContain('CANCELLED');
    expect(texts(buildPdfDefinition(crf, null))).not.toContain('CANCELLED');
  });
});

describe('renderReceiptPdf', () => {
  it('renders a valid one-page PDF, and a different design gives a different file', async () => {
    const a = await renderReceiptPdf(crf, null);
    expect(Buffer.from(a.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(Buffer.from(a.subarray(-8)).toString('latin1')).toContain('%%EOF');
    const tpl = defaultReceiptTemplate();
    tpl.style.paper = 'thermal';
    tpl.style.accent = '#AA3300';
    const b = await renderReceiptPdf(crf, tpl);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(false);
    expect((Buffer.from(a).toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
});
