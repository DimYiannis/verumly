import { describe, expect, it } from 'vitest';
import { FORMAT_COUNTRY_CODES, getFormat } from '@lr/compliance';
import type { Crf } from '@lr/schema';
import { cashRounding, deriveVatSummary, isFinalState, lineTotal, validateCrf, vatFromGross } from '../src/index.ts';

const ids: Record<string, { company: string; vat: string | null }> = {
  NL: { company: '12345678', vat: 'NL123456789B01' },
  DE: { company: '1234567890', vat: 'DE123456789' },
  FR: { company: '12345678901234', vat: 'FR12345678901' },
  GB: { company: 'AB123456', vat: null },
  PL: { company: '5213456789', vat: null },
};

function receipt(country: string, rate: number, state: Crf['state'] = 'paid'): Crf {
  const f = getFormat(country)!;
  const unit = 1000;
  const lines: Crf['lines'] = [{ lineNo: 1, kind: 'item', sku: null, description: 'Item', qty: '1', unitPrice: unit, vatRate: rate, discount: 0, total: lineTotal('1', unit, 0), category: null }];
  const vatSummary = deriveVatSummary(lines);
  const id = ids[country] ?? { company: '12345678', vat: null };
  return {
    crf: '1',
    receiptId: '01a145f9-7f3e-76c3-8869-f3cb814931c1',
    version: 1,
    state,
    merchant: { kvkNumber: id.company, vatNumber: id.vat, name: 'Shop', locationId: '3f0c4f0e-8a56-4c59-9d3b-0e7f4a9d6c11', terminalId: '5a0c4f0e-8a56-4c59-9d3b-0e7f4a9d6c11' },
    createdAt: '2026-10-16T10:00:00.000Z',
    currency: f.currency,
    lines,
    vatSummary,
    totals: { gross: unit, net: vatSummary[0]!.net, vat: vatSummary[0]!.vat, tip: 0, rounding: 0 },
    payments: state === 'paid' ? [{ method: 'card', amount: unit }] : [],
    fiscal: { country, registerSerial: null, documentNumber: null, extra: {} },
    voidOf: null,
  };
}

describe('VAT with decimal rates', () => {
  it('splits gross into net and vat for 5.5% and 25.5%', () => {
    expect(vatFromGross(1055, 5.5)).toEqual({ net: 1000, vat: 55 });
    expect(vatFromGross(1255, 25.5)).toEqual({ net: 1000, vat: 255 });
    expect(vatFromGross(1210, 21)).toEqual({ net: 1000, vat: 210 });
  });

  it('keeps the whole-percent results of NL unchanged', () => {
    expect(vatFromGross(680, 9)).toEqual({ net: 624, vat: 56 });
    expect(vatFromGross(389, 21)).toEqual({ net: 321, vat: 68 });
  });
});

describe('cash rounding by step', () => {
  it('5 (default), 50 and 100 minor units', () => {
    expect(cashRounding(534)).toBe(1);
    expect(cashRounding(1069, 5)).toBe(1);
    expect(cashRounding(1030, 50)).toBe(20);
    expect(cashRounding(1049, 100)).toBe(-49);
    expect(cashRounding(1051, 100)).toBe(49);
  });
});

describe('validateCrf per country', () => {
  it.each([
    ['NL', 9],
    ['DE', 19],
    ['FR', 5.5],
    ['GB', 20],
    ['PL', 23],
  ])('a valid %s receipt at %s%%', (country, rate) => {
    const state = getFormat(country)!.fiscal === 'required' ? 'paid' : 'paid';
    expect(validateCrf(receipt(country, rate, state), { country })).toEqual([]);
  });

  it('rejects a rate that does not exist in the country', () => {
    expect(validateCrf(receipt('DE', 21), { country: 'DE' }).map((i) => i.code)).toContain('vat_rate_not_allowed');
    expect(validateCrf(receipt('NL', 19), { country: 'NL' }).map((i) => i.code)).toContain('vat_rate_not_allowed');
    expect(validateCrf(receipt('FR', 5.5), { country: 'FR' })).toEqual([]);
  });

  it('rejects the wrong currency, and a receipt that says another country', () => {
    const r = receipt('GB', 20);
    expect(validateCrf({ ...r, currency: 'EUR' }, { country: 'GB' }).map((i) => i.code)).toContain('currency_mismatch');
    expect(validateCrf(r, { country: 'NL' }).map((i) => i.code)).toEqual(expect.arrayContaining(['country_mismatch', 'currency_mismatch']));
  });

  it('checks the company id and VAT id with the country pattern (NL stays strict)', () => {
    const de = receipt('DE', 19);
    expect(validateCrf({ ...de, merchant: { ...de.merchant, kvkNumber: 'abc' } }, { country: 'DE' }).map((i) => i.code)).toContain('company_id');
    expect(validateCrf({ ...de, merchant: { ...de.merchant, vatNumber: 'DE12' } }, { country: 'DE' }).map((i) => i.code)).toContain('vat_id');
    const nl = receipt('NL', 9);
    expect(validateCrf({ ...nl, merchant: { ...nl.merchant, kvkNumber: '1234' } }, { country: 'NL' }).map((i) => i.code)).toContain('company_id');
    expect(validateCrf({ ...nl, merchant: { ...nl.merchant, vatNumber: 'DE123456789' } }, { country: 'NL' }).map((i) => i.code)).toContain('vat_id');
  });

  it('cash rounding must fit the country step', () => {
    const cashed = (country: string, rounding: number, rate: number) => {
      const r = receipt(country, rate);
      return { ...r, totals: { ...r.totals, rounding }, payments: [{ method: 'cash' as const, amount: r.totals.gross + rounding }] };
    };
    expect(validateCrf(cashed('NL', 2, 9), { country: 'NL' })).toEqual([]);
    expect(validateCrf(cashed('NL', 3, 9), { country: 'NL' }).map((i) => i.code)).toContain('rounding_range');
    // no rounding in DE
    expect(validateCrf(cashed('DE', 1, 19), { country: 'DE' }).map((i) => i.code)).toContain('rounding_range');
  });

  it('an unknown country is refused', () => {
    expect(validateCrf(receipt('NL', 9), { country: 'XX' }).map((i) => i.code)).toContain('unknown_country');
  });
});

describe('every supported country', () => {
  it('has a format whose rates all fit the schema', () => {
    for (const code of FORMAT_COUNTRY_CODES) {
      const f = getFormat(code)!;
      expect(f.vatRates.includes(0), code).toBe(true);
      expect(f.currency, code).toMatch(/^[A-Z]{3}$/);
      expect(() => Intl.DateTimeFormat('en', { timeZone: f.timezone }), code).not.toThrow();
      expect(() => new Intl.NumberFormat(f.locale, { style: 'currency', currency: f.currency }), code).not.toThrow();
    }
  });

  it('finality follows the fiscal mode', () => {
    expect(isFinalState('paid', 'NL')).toBe(true);
    expect(isFinalState('paid', 'GB')).toBe(true);
    expect(isFinalState('paid', 'DE')).toBe(false);
    expect(isFinalState('fiscalised', 'DE')).toBe(true);
    // BE: the fiscal step is optional, so both end the receipt
    expect(isFinalState('paid', 'BE')).toBe(true);
    expect(isFinalState('fiscalised', 'BE')).toBe(true);
    expect(isFinalState('fiscalised', 'NL')).toBe(false);
  });
});
