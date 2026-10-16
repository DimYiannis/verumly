import { describe, expect, it } from 'vitest';
import { RECEIPT_STATES, type ReceiptState } from '@lr/schema';
import { checkTransition, isFinalState, isVisibleToResolvers, validateCrf } from '../src/index.ts';

/** v2 §6, restated by hand: the cells of the table that are allowed. Everything else must be rejected. */
const ALLOWED_NL: Array<[ReceiptState, ReceiptState]> = [
  ['open', 'presented'],
  ['presented', 'presented'],
  ['open', 'paid'],
  ['presented', 'paid'],
  ['open', 'void'],
  ['presented', 'void'],
  ['paid', 'void'],
  // "any → void": a stored fiscalised receipt cannot exist for NL, but the table itself does not depend on the country
  ['fiscalised', 'void'],
];
const ALLOWED_NON_NL: Array<[ReceiptState, ReceiptState]> = [...ALLOWED_NL, ['paid', 'fiscalised']];

describe('checkTransition: every (from, to) pair', () => {
  const pairs = RECEIPT_STATES.flatMap((from) => RECEIPT_STATES.map((to) => ({ from, to })));

  it.each(pairs)('NL $from → $to', ({ from, to }) => {
    const r = checkTransition(from, to, 'NL');
    if (to === 'fiscalised') expect(r).toEqual({ ok: false, reason: 'fiscalised_not_allowed_nl' });
    else if (ALLOWED_NL.some(([f, t]) => f === from && t === to)) expect(r).toEqual({ ok: true });
    else expect(r).toEqual({ ok: false, reason: 'bad_transition' });
  });

  it.each(pairs)('DE $from → $to', ({ from, to }) => {
    const r = checkTransition(from, to, 'DE');
    expect(r.ok).toBe(ALLOWED_NON_NL.some(([f, t]) => f === from && t === to));
  });

  it('the default country is NL', () => {
    expect(checkTransition('paid', 'fiscalised')).toEqual({ ok: false, reason: 'fiscalised_not_allowed_nl' });
  });

  it.each(RECEIPT_STATES)('start state → %s', (to) => {
    const ok = to === 'open' || to === 'presented' || to === 'paid';
    expect(checkTransition(null, to, 'NL').ok).toBe(ok);
    expect(checkTransition(null, to, 'DE').ok).toBe(ok);
  });

  it('void is terminal and every other non-void state can reach void', () => {
    for (const to of RECEIPT_STATES) expect(checkTransition('void', to, 'DE').ok).toBe(false);
    for (const from of ['open', 'presented', 'paid', 'fiscalised'] as const) expect(checkTransition(from, 'void', 'DE').ok).toBe(true);
  });
});

describe('finality and visibility', () => {
  it('NL: paid and void are final; open, presented are not; fiscalised never occurs', () => {
    expect(RECEIPT_STATES.filter((s) => isFinalState(s, 'NL'))).toEqual(['paid', 'void']);
  });

  it('non-NL: fiscalised and void are final, paid is not', () => {
    expect(RECEIPT_STATES.filter((s) => isFinalState(s, 'DE'))).toEqual(['fiscalised', 'void']);
  });

  it('only open receipts are hidden from resolvers', () => {
    expect(RECEIPT_STATES.filter((s) => !isVisibleToResolvers(s))).toEqual(['open']);
  });
});

describe('validateCrf and fiscalised', () => {
  const base = {
    crf: '1',
    receiptId: '01a145f9-7f3e-76c3-8869-f3cb814931c1',
    version: 2,
    state: 'fiscalised',
    merchant: { kvkNumber: '12345678', vatNumber: null, name: 'X', locationId: '3f0c4f0e-8a56-4c59-9d3b-0e7f4a9d6c11', terminalId: '5a0c4f0e-8a56-4c59-9d3b-0e7f4a9d6c11' },
    createdAt: '2026-10-16T10:00:00.000Z',
    currency: 'EUR',
    lines: [{ lineNo: 1, kind: 'item', sku: null, description: 'Koffie', qty: '2', unitPrice: 340, vatRate: 9, discount: 0, total: 680, category: null }],
    vatSummary: [{ rate: 9, gross: 680, net: 624, vat: 56 }],
    totals: { gross: 680, net: 624, vat: 56, tip: 0, rounding: 0 },
    payments: [{ method: 'card', amount: 680 }],
    fiscal: { country: 'NL', registerSerial: null, documentNumber: null, extra: {} },
    voidOf: null,
  };

  it('an NL organisation: fiscalised is an issue', () => {
    expect(validateCrf(base, { country: 'NL' }).map((i) => i.code)).toContain('fiscalised_not_allowed_nl');
    expect(validateCrf(base).map((i) => i.code)).toContain('fiscalised_not_allowed_nl');
  });

  it('another country: fiscalised is not an issue', () => {
    expect(validateCrf(base, { country: 'DE' })).toEqual([]);
  });
});
