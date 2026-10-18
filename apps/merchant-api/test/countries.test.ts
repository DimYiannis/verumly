import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, newReceiptId } from '@lr/crypto';
import type { Crf } from '@lr/schema';
import { buildCrf, createWorld, sql, submit, type OrgFixture, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
let de: OrgFixture;
let gb: OrgFixture;
let fr: OrgFixture;

beforeAll(async () => {
  w = await createWorld();
  de = await w.addOrg({ country: 'DE' });
  gb = await w.addOrg({ country: 'GB' });
  fr = await w.addOrg({ country: 'FR' });
}, 120_000);
afterAll(async () => {
  await w.close();
});

const codes = (res: { body: unknown }) => ((res.body as { issues?: Array<{ code: string }> }).issues ?? []).map((i) => i.code);

describe('the merchant API checks a receipt against the country of the organisation', () => {
  it('DE: a paid receipt at German rates is accepted, then fiscalised with its TSE data', async () => {
    const receiptId = newReceiptId();
    const paid = buildCrf({ receiptId, version: 1, state: 'paid', org: de });
    expect(paid.currency).toBe('EUR');
    expect(paid.lines[0]!.vatRate).toBe(7); // the default coffee line: the reduced German rate
    expect((await submit(w.merchant, de, paid, { secret: generateSecret() })).status).toBe(201);

    const fiscalised = buildCrf({ receiptId, version: 2, state: 'fiscalised', org: de });
    expect(Object.keys(fiscalised.fiscal.extra)).toEqual(expect.arrayContaining(['tseSerial', 'transactionNumber', 'signature']));
    expect((await submit(w.merchant, de, fiscalised)).status).toBe(201);
    const [r] = await sql<{ state: string }>(w, 'select state from merchant.receipts where id = $1', [receiptId]);
    expect(r?.state).toBe('fiscalised');
  });

  it('DE: fiscalised without the TSE data is refused (422), and nothing is stored', async () => {
    const receiptId = newReceiptId();
    expect((await submit(w.merchant, de, buildCrf({ receiptId, version: 1, state: 'paid', org: de }), { secret: generateSecret() })).status).toBe(201);
    const bare: Crf = { ...buildCrf({ receiptId, version: 2, state: 'fiscalised', org: de }), fiscal: { country: 'DE', registerSerial: null, documentNumber: null, extra: {} } };
    const res = await submit(w.merchant, de, bare);
    expect(res.status).toBe(422);
    expect(codes(res)).toContain('fiscal_fields_missing');
    const [r] = await sql<{ state: string }>(w, 'select state from merchant.receipts where id = $1', [receiptId]);
    expect(r?.state).toBe('paid');
  });

  it('DE: a Dutch VAT rate, the wrong currency or a Dutch-style id are refused', async () => {
    const base = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'paid', org: de });
    const secret = { secret: generateSecret() };
    const nl9 = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'paid', org: de, lines: [{ unitPrice: 340, vatRate: 9 }] });
    expect(codes(await submit(w.merchant, de, nl9, secret))).toContain('vat_rate_not_allowed');
    expect(codes(await submit(w.merchant, de, { ...base, receiptId: newReceiptId(), currency: 'PLN' }, secret))).toContain('currency_mismatch');
    expect(codes(await submit(w.merchant, de, { ...base, receiptId: newReceiptId(), merchant: { ...base.merchant, kvkNumber: 'KVK-12' } }, secret))).toContain('company_id');
  });

  it('DE: cash is not rounded (no rounding step in Germany)', async () => {
    const base = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'paid', org: de });
    const rounded: Crf = { ...base, totals: { ...base.totals, rounding: 1 }, payments: [{ method: 'cash', amount: base.totals.gross + 1 }] };
    expect(codes(await submit(w.merchant, de, rounded, { secret: generateSecret() }))).toContain('rounding_range');
  });

  it('GB: pounds, no fiscal step: a paid receipt is final, fiscalised is refused', async () => {
    const receiptId = newReceiptId();
    const paid = buildCrf({ receiptId, version: 1, state: 'paid', org: gb });
    expect(paid.currency).toBe('GBP');
    expect((await submit(w.merchant, gb, paid, { secret: generateSecret() })).status).toBe(201);
    const [row] = await sql<{ currency: string }>(w, 'select currency from merchant.receipts where id = $1', [receiptId]);
    expect(row?.currency).toBe('GBP');
    expect(codes(await submit(w.merchant, gb, { ...buildCrf({ receiptId, version: 2, state: 'fiscalised', org: gb }) }))).toContain('fiscalised_not_allowed');
    // euros are not accepted for a British organisation
    const euro: Crf = { ...paid, receiptId: newReceiptId(), currency: 'EUR' };
    expect(codes(await submit(w.merchant, gb, euro, { secret: generateSecret() }))).toContain('currency_mismatch');
  });

  it('FR: a decimal VAT rate (5.5%) is stored exactly, per line and per rate', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'paid', org: fr, lines: [{ description: 'Baguette', unitPrice: 1055, vatRate: 5.5 }, { description: 'Vin', unitPrice: 1200, vatRate: 20 }] });
    expect(crf.vatSummary.find((v) => v.rate === 5.5)).toMatchObject({ gross: 1055, net: 1000, vat: 55 });
    expect((await submit(w.merchant, fr, crf, { secret: generateSecret() })).status).toBe(201);
    const lines = await sql<{ vat_rate: string }>(w, 'select vat_rate::text from merchant.receipt_lines where receipt_id = $1 order by line_no', [receiptId]);
    expect(lines.map((l) => l.vat_rate)).toEqual(['5.50', '20.00']);
  });

  it('an organisation cannot sign a receipt that says another country', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'paid', org: de });
    const says: Crf = { ...crf, fiscal: { ...crf.fiscal, country: 'NL' } };
    expect(codes(await submit(w.merchant, de, says, { secret: generateSecret() }))).toContain('country_mismatch');
  });
});
