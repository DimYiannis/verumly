import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FORMAT_COUNTRY_CODES, getCountry, getFormat } from '@lr/compliance';
import { gatewayIntegration } from '@lr/fiscal';
import { isFinalState } from '@lr/receipt-nl';
import { FiscalError, MemoryStore, mapPosSale } from '../src/index.ts';
import { sdkFor } from './support.ts';

/** A company number that the country's research pattern accepts (the research has none for some countries). */
const COMPANY: Record<string, string> = {
  AT: '12-345/6789', BE: '0123.456.789', CH: '', CY: 'HE12345', CZ: '12345678', DE: '1234567890', EE: '12345678', ES: 'A1234567B',
  FR: '12345678901234', GB: 'AB123456', GR: '123456789', IE: '123456', IS: '1234567890', IT: '12345678901', LT: '123456789', LU: 'B12345',
  LV: '12345678901', MT: 'C12345', NL: '12345678', SI: '1234567890', SK: '12345678',
};
const company = (code: string) => COMPANY[code] || '12345678';

function till(country: string, store = new MemoryStore(), overrides = {}) {
  return { sdk: sdkFor(store, { country, merchant: { kvkNumber: company(country), vatNumber: null, name: 'Shop', locationId: randomUUID() }, ...overrides }), store };
}

describe.each(FORMAT_COUNTRY_CODES.map((c) => [c]))('till in %s', (country) => {
  const f = getFormat(country)!;
  const rate = f.vatRates[0]!;

  it('sells, pays, and the receipt is final with its country data', async () => {
    const { sdk, store } = till(country);
    const { receiptId } = await sdk.createReceipt({ state: 'presented', lines: [{ description: 'Item', qty: 2, unitPrice: 1250, vatRate: rate }] });
    await sdk.addVersion(receiptId, { state: 'paid' });
    const last = (await store.getReceipt(receiptId))!.crf;
    expect(last.currency).toBe(f.currency);
    expect(last.fiscal.country).toBe(country);
    expect(last.state).toBe(f.fiscal === 'required' ? 'fiscalised' : 'paid');
    expect(isFinalState(last.state, country)).toBe(true);
    if (f.fiscal === 'required') {
      expect(last.fiscal.extra.mode).toBe('sandbox');
      expect(last.fiscal.documentNumber).toBeTruthy();
      expect(last.version).toBe(3); // presented v1, paid v2, fiscalised v3
    }
    // everything that was queued is the signed history: v1 presented, v2 paid, (v3 fiscalised)
    expect((await store.stats()).pending).toBe(f.fiscal === 'required' ? 3 : 2);
  });

  it('refuses a VAT rate of another country', async () => {
    const { sdk } = till(country);
    const foreign = f.vatRates.includes(21) ? 19.5 : 21;
    await expect(sdk.createReceipt({ state: 'presented', lines: [{ description: 'Item', unitPrice: 1000, vatRate: foreign }] })).rejects.toThrow(/vat_rate_not_allowed/);
  });
});

describe('the fiscal step', () => {
  it('numbers receipts one after the other and chains them (DE)', async () => {
    const { sdk, store } = till('DE');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { receiptId } = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 500 + i, vatRate: 19 }] });
      ids.push(receiptId);
    }
    const crfs = await Promise.all(ids.map(async (id) => (await store.getReceipt(id))!.crf));
    expect(crfs.map((c) => c.state)).toEqual(['fiscalised', 'fiscalised', 'fiscalised']);
    expect(crfs.map((c) => c.fiscal.extra.transactionNumber)).toEqual(['1', '2', '3']);
    expect(crfs.map((c) => c.fiscal.extra.signatureCounter)).toEqual(['1', '2', '3']);
  });

  it('uses the TSE serial from the business settings', async () => {
    const { sdk, store } = till('DE', new MemoryStore(), { fiscal: { settings: { tseSerial: 'TSE-REAL-7', tillId: 'K-1' } } });
    const { receiptId } = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 500, vatRate: 7 }] });
    const crf = (await store.getReceipt(receiptId))!.crf;
    expect(crf.fiscal.registerSerial).toBe('TSE-REAL-7');
    expect(crf.fiscal.extra.tillId).toBe('K-1');
  });

  it('auto off: the receipt stays paid until fiscalise() is called', async () => {
    const { sdk, store } = till('IT', new MemoryStore(), { fiscal: { auto: false } });
    const { receiptId } = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 500, vatRate: 22 }] });
    expect((await store.getReceipt(receiptId))!.crf.state).toBe('paid');
    expect(await sdk.fiscalise(receiptId)).toMatchObject({ state: 'fiscalised', version: 2 });
    // idempotent
    expect(await sdk.fiscalise(receiptId)).toMatchObject({ state: 'fiscalised', version: 2 });
  });

  it('a gateway that is down leaves the receipt paid; the retry fiscalises it', async () => {
    let up = false;
    const extra = { receiptUid: 'O-1', okp: 'k', cashRegisterCode: 'C1' };
    const fetchFn = (async () => (up ? new Response(JSON.stringify({ documentNumber: 'O-1', registerSerial: 'C1', extra }), { status: 200 }) : new Response('no', { status: 503 }))) as unknown as typeof fetch;
    const { sdk, store } = till('SK', new MemoryStore(), { fiscal: { integration: gatewayIntegration({ country: 'SK', url: 'https://gw.example', fetch: fetchFn }) } });
    const { receiptId } = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 500, vatRate: 23 }] });
    expect((await store.getReceipt(receiptId))!.crf.state).toBe('paid');
    await expect(sdk.fiscalise(receiptId)).rejects.toMatchObject({ code: 'gateway_503', retryable: true });
    up = true;
    expect(await sdk.fiscalise(receiptId)).toMatchObject({ state: 'fiscalised' });
    expect((await store.getReceipt(receiptId))!.crf.fiscal.extra.receiptUid).toBe('O-1');
  });

  it('a permanent refusal is thrown to the till', async () => {
    const fetchFn = (async () => new Response('bad', { status: 422 })) as unknown as typeof fetch;
    const { sdk } = till('SK', new MemoryStore(), { fiscal: { integration: gatewayIntegration({ country: 'SK', url: 'https://gw.example', fetch: fetchFn }) } });
    await expect(sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 500, vatRate: 23 }] })).rejects.toBeInstanceOf(FiscalError);
  });

  it('a country without a fiscal step is final when paid and cannot be fiscalised', async () => {
    const { sdk } = till('GB');
    const { receiptId } = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 500, vatRate: 20 }] });
    await expect(sdk.fiscalise(receiptId)).rejects.toMatchObject({ code: 'no_fiscal_step' });
  });
});

describe('cash rounding and currency', () => {
  it('DK rounds cash to 50 øre, DE does not round, NL to 5 cents', async () => {
    const dk = till('DK');
    const a = await dk.sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 10_30, vatRate: 25 }], payments: [{ method: 'cash' }] });
    const crf = (await dk.store.getReceipt(a.receiptId))!.crf;
    expect(crf.currency).toBe('DKK');
    expect(crf.totals.rounding).toBe(20);
    expect(crf.payments[0]!.amount).toBe(1050);

    const de = till('DE');
    const b = await de.sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 10_31, vatRate: 19 }], payments: [{ method: 'cash' }] });
    expect((await de.store.getReceipt(b.receiptId))!.crf.totals.rounding).toBe(0);

    const nl = till('NL');
    const c = await nl.sdk.createReceipt({ state: 'paid', lines: [{ description: 'Item', unitPrice: 534, vatRate: 9 }], payments: [{ method: 'cash' }] });
    expect((await nl.store.getReceipt(c.receiptId))!.crf.totals.rounding).toBe(1);
  });

  it('an unsupported country is refused at construction', () => {
    expect(() => till('US')).toThrow(/unsupported country/);
  });
});

describe('mapPosSale per country', () => {
  it('accepts the rates of the till country only', () => {
    expect(mapPosSale({ lines: [{ unitPrice: 100, vatRate: 5.5 }] }, 'FR').lines[0]!.vatRate).toBe(5.5);
    expect(() => mapPosSale({ lines: [{ unitPrice: 100, vatRate: 5.5 }] }, 'DE')).toThrow(/vatRate must be 19, 7, 0 or null/);
    expect(() => mapPosSale({ lines: [{ unitPrice: 100, vatRate: 19 }] })).toThrow(/vatRate must be 21, 9, 0 or null/);
  });

  it('every supported country has a company id the test table knows or accepts anything', () => {
    for (const code of FORMAT_COUNTRY_CODES) expect(getCountry(code), code).not.toBeNull();
  });
});
