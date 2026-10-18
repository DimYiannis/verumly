import { describe, expect, it } from 'vitest';
import { FORMAT_COUNTRY_CODES, getCountry, getFormat } from '@lr/compliance';
import type { Crf } from '@lr/schema';
import { FISCAL_SPECS, gatewayIntegration, getFiscalSpec, MemoryFiscalState, missingFiscalKeys, SANDBOX_COUNTRIES, sandboxIntegration, type FiscalContext } from '../src/index.ts';

const TERMINAL = '5a0c4f0e-8a56-4c59-9d3b-0e7f4a9d6c11';

function paid(country: string): Crf {
  return {
    crf: '1',
    receiptId: '01a145f9-7f3e-76c3-8869-f3cb814931c1',
    version: 1,
    state: 'paid',
    merchant: { kvkNumber: '12345678', vatNumber: null, name: 'Shop', locationId: TERMINAL, terminalId: TERMINAL },
    createdAt: '2026-10-16T10:00:00.000Z',
    currency: getFormat(country)!.currency,
    lines: [{ lineNo: 1, kind: 'item', sku: null, description: 'Item', qty: '1', unitPrice: 1000, vatRate: 0, discount: 0, total: 1000, category: null }],
    vatSummary: [{ rate: 0, gross: 1000, net: 1000, vat: 0 }],
    totals: { gross: 1000, net: 1000, vat: 0, tip: 0, rounding: 0 },
    payments: [{ method: 'card', amount: 1000 }],
    fiscal: { country, registerSerial: null, documentNumber: null, extra: {} },
    voidOf: null,
  };
}
const ctx = (country: string, state = new MemoryFiscalState(), settings: FiscalContext['settings'] = {}): FiscalContext => ({ receipt: paid(country), settings, state, terminalId: TERMINAL });

describe('specs and formats agree', () => {
  it('a country has a fiscal spec exactly when its receipts have a fiscal step', () => {
    for (const code of FORMAT_COUNTRY_CODES) {
      const mode = getFormat(code)!.fiscal;
      expect(getFiscalSpec(code) !== null, code).toBe(mode !== 'none');
    }
  });

  it('every spec has a sandbox builder, and the settings it reads exist in the legal research', () => {
    expect([...SANDBOX_COUNTRIES].sort()).toEqual(FISCAL_SPECS.map((s) => s.country).sort());
    for (const spec of FISCAL_SPECS) {
      const keys = new Set(getCountry(spec.country)!.settings.map((x) => x.key));
      for (const n of spec.needs) expect(keys.has(n), `${spec.country}.${n}`).toBe(true);
      expect(spec.fields.length, spec.country).toBeGreaterThan(1);
      expect(new Set(spec.fields.map((f) => f.key)).size, spec.country).toBe(spec.fields.length);
    }
  });
});

describe('sandbox integration', () => {
  it.each(FISCAL_SPECS.map((s) => s.country))('%s: gives every field the country needs, marked as sandbox, within the schema limits', async (country) => {
    const res = await sandboxIntegration(country).submit(ctx(country));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.mode).toBe('sandbox');
    expect(res.extra.mode).toBe('sandbox');
    expect(missingFiscalKeys(country, res.extra)).toEqual([]);
    expect(Object.keys(res.extra).length).toBeLessThanOrEqual(12);
    for (const v of Object.values(res.extra)) expect(v.length).toBeLessThanOrEqual(200);
    expect(res.documentNumber?.length ?? 0).toBeLessThanOrEqual(60);
    expect(res.registerSerial?.length ?? 0).toBeLessThanOrEqual(60);
    if (res.registerSerial) expect(res.registerSerial.startsWith('SBX-') || res.registerSerial.length > 0).toBe(true);
    for (const v of Object.values(res.extra)) if (v.startsWith('http')) expect(new URL(v).hostname.endsWith('.invalid')).toBe(true);
  });

  it('counts up per register, and chains hashes (ES)', async () => {
    const state = new MemoryFiscalState();
    const es = sandboxIntegration('ES');
    const a = await es.submit(ctx('ES', state));
    const b = await es.submit(ctx('ES', state));
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.extra.invoiceId).toBe('T-1');
    expect(b.extra.invoiceId).toBe('T-2');
    expect(a.extra.previousHash).toBe('GENESIS');
    expect(b.extra.previousHash).toBe(a.extra.hash);
    expect(b.extra.hash).not.toBe(a.extra.hash);
  });

  it('uses the settings the business entered (the TSE serial of DE)', async () => {
    const res = await sandboxIntegration('DE').submit(ctx('DE', new MemoryFiscalState(), { tseSerial: 'TSE-REAL-42', tillId: 'KASSE-1' }));
    if (!res.ok) throw new Error('expected ok');
    expect(res.extra.tseSerial).toBe('TSE-REAL-42');
    expect(res.registerSerial).toBe('TSE-REAL-42');
    expect(res.extra.signatureCounter).toBe('1');
  });

  it('a country without a fiscal step has no integration', async () => {
    const nl = sandboxIntegration('NL');
    expect(nl.mode).toBe('none');
    expect(await nl.submit(ctx('NL'))).toEqual({ ok: false, retryable: false, code: 'no_fiscal_step' });
  });
});

describe('gateway integration', () => {
  const okBody = { documentNumber: 'D-1', registerSerial: 'REG-1', extra: { tseSerial: 'a', tillId: 'b', transactionNumber: '1', signatureCounter: '1', start: 's', end: 'e', signature: 'x' } };
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('posts the receipt and the settings, with the key, and returns the answer as live', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(okBody), { status: 200 });
    }) as unknown as typeof fetch;
    const g = gatewayIntegration({ country: 'de', url: 'https://gw.example/fiscalise', apiKey: 'k', fetch: f });
    const res = await g.submit(ctx('DE', new MemoryFiscalState(), { tseSerial: 'a' }));
    expect(res).toMatchObject({ ok: true, mode: 'live', documentNumber: 'D-1', registerSerial: 'REG-1' });
    expect(seen?.url).toBe('https://gw.example/fiscalise');
    expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer k');
    const sent = JSON.parse(String(seen?.init.body));
    expect(sent.country).toBe('DE');
    expect(sent.receipt.receiptId).toBeDefined();
    expect(sent.settings).toEqual({ tseSerial: 'a' });
  });

  it('server errors and network errors are retryable; a refusal or an incomplete answer is not', async () => {
    const run = (f: typeof fetch) => gatewayIntegration({ country: 'DE', url: 'https://gw.example', fetch: f }).submit(ctx('DE'));
    expect(await run(respond(503, {}))).toEqual({ ok: false, retryable: true, code: 'gateway_503' });
    expect(await run(respond(429, {}))).toEqual({ ok: false, retryable: true, code: 'gateway_429' });
    expect(await run((async () => { throw new TypeError('network'); }) as unknown as typeof fetch)).toEqual({ ok: false, retryable: true, code: 'gateway_unreachable' });
    expect(await run(respond(422, {}))).toEqual({ ok: false, retryable: false, code: 'gateway_rejected_422' });
    expect(await run(respond(200, { nope: 1 }))).toEqual({ ok: false, retryable: false, code: 'gateway_bad_answer' });
    expect(await run(respond(200, { extra: { tseSerial: 'a' } }))).toEqual({ ok: false, retryable: false, code: 'gateway_incomplete' });
  });
});
