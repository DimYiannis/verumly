import { describe, expect, it } from 'vitest';
import {
  amsterdamLocalToUtc,
  merchantKeyOf,
  normaliseBtwId,
  normaliseKvk,
  normaliseName,
  normaliseOcrText,
  normalisePostcode,
  parseCents,
  parseQty,
  parseVatRate,
  printedToUtc,
  QIANFAN_PROMPTS,
} from '../src/index.ts';

describe('parseCents (Dutch decimals)', () => {
  const cases: [unknown, number | null][] = [
    ['1.234,56', 123456],
    ['12.345.678,90', 1234567890],
    ['3,40', 340],
    ['0,05', 5],
    ['-3,50', -350],
    ['3,50-', -350],
    ['(3,50)', -350],
    ['€ 12,5', 1250],
    ['EUR 12,50', 1250],
    [' 1 249,00 ', 124900],
    ['12.50', 1250],
    ['1.234', 123400],
    ['7', 700],
    [3.4, 340],
    ['1,234,56', null],
    ['12,345', null],
    ['abc', null],
    ['', null],
    [null, null],
    [{}, null],
  ];
  it.each(cases)('%j → %j', (input, expected) => {
    expect(parseCents(input)).toBe(expected);
  });
});

describe('parseQty', () => {
  const cases: [unknown, string | undefined][] = [
    ['2', '2'],
    ['2x', '2'],
    ['0,412 kg', '0.412'],
    ['0,350', '0.35'],
    ['-1', '-1'],
    [null, '1'],
    ['', '1'],
    [3, '3'],
    ['0,4125', undefined],
    ['twee', undefined],
  ];
  it.each(cases)('%j → %j', (input, expected) => {
    expect(parseQty(input)).toBe(expected);
  });
});

describe('parseVatRate', () => {
  const cases: [unknown, 21 | 9 | 0 | null][] = [['9', 9], ['9%', 9], ['21,0 %', 21], [21, 21], ['0%', 0], ['6%', null], ['A', null], [null, null]];
  it.each(cases)('%j → %j', (input, expected) => {
    expect(parseVatRate(input)).toBe(expected);
  });
});

describe('normaliseOcrText', () => {
  it('maps full-width digits, unicode minus, nbsp and markdown emphasis without touching digits', () => {
    expect(normaliseOcrText('**TOTAAL**\u00a0\uff11\uff12,50\r\nAfronding \u22120,02')).toBe('TOTAAL 12,50\nAfronding -0,02');
    expect(normaliseOcrText('0,02\u2212')).toBe('0,02-');
  });
  it('does not repair OCR digit confusions', () => {
    expect(normaliseOcrText('TOTAAL 4O,8O')).toBe('TOTAAL 4O,8O');
  });
});

describe('NL identifier formats', () => {
  it('KvK is exactly 8 digits', () => {
    expect(normaliseKvk('12345678')).toBe('12345678');
    expect(normaliseKvk('1234 5678')).toBe('12345678');
    expect(normaliseKvk('1234567')).toBeNull();
    expect(normaliseKvk('123456789')).toBeNull();
    expect(normaliseKvk('1234567A')).toBeNull();
    expect(normaliseKvk(null)).toBeNull();
  });
  it('BTW-id is NL + 9 digits + B + 2 digits (format only)', () => {
    expect(normaliseBtwId('NL123456782B01')).toBe('NL123456782B01');
    expect(normaliseBtwId('nl 1234.56.782 b01')).toBe('NL123456782B01');
    expect(normaliseBtwId('NL12345678B01')).toBeNull();
    expect(normaliseBtwId('NL123456782B1')).toBeNull();
    expect(normaliseBtwId('BE0123456789')).toBeNull();
  });
  it('postcode is 4 digits (not starting with 0) + 2 letters', () => {
    expect(normalisePostcode('1012 ab')).toBe('1012AB');
    expect(normalisePostcode('0123 AB')).toBeNull();
    expect(normalisePostcode('1012')).toBeNull();
  });
});

describe('merchantKeyOf', () => {
  const base = { name: 'Café "Het Plein" B.V.', kvkNumber: '12345678', vatNumber: 'NL123456782B01', postcode: '1012 ab' };
  it('prefers vat, then kvk, then name|postcode', () => {
    expect(merchantKeyOf(base)).toBe('vat:NL123456782B01');
    expect(merchantKeyOf({ ...base, vatNumber: null })).toBe('kvk:12345678');
    expect(merchantKeyOf({ ...base, vatNumber: null, kvkNumber: null })).toBe('name:cafe het plein b v|1012AB');
    expect(merchantKeyOf({ name: null, kvkNumber: null, vatNumber: null, postcode: '1012AB' })).toBeNull();
  });
  it('ignores identifiers that fail their format check', () => {
    expect(merchantKeyOf({ ...base, vatNumber: 'NL12345B01' })).toBe('kvk:12345678');
    expect(merchantKeyOf({ ...base, vatNumber: null, kvkNumber: '1234567' })).toBe('name:cafe het plein b v|1012AB');
  });
  it('name normalisation is stable across case, diacritics and punctuation', () => {
    expect(normaliseName('  CAFÉ   het-plein ')).toBe(normaliseName('cafe Het Plein'));
  });
});

describe('Europe/Amsterdam → UTC', () => {
  it('winter (CET, +1) and summer (CEST, +2)', () => {
    expect(amsterdamLocalToUtc(2026, 1, 15, 12, 0)).toBe('2026-01-15T11:00:00Z');
    expect(amsterdamLocalToUtc(2026, 7, 15, 12, 0)).toBe('2026-07-15T10:00:00Z');
  });
  it('around the October switch back (25 Oct 2026)', () => {
    expect(amsterdamLocalToUtc(2026, 10, 24, 20, 0)).toBe('2026-10-24T18:00:00Z');
    expect(amsterdamLocalToUtc(2026, 10, 26, 20, 0)).toBe('2026-10-26T19:00:00Z');
    expect(amsterdamLocalToUtc(2026, 10, 25, 8, 10)).toBe('2026-10-25T07:10:00Z');
    // 02:30 happens twice; the first (CEST) occurrence wins
    expect(amsterdamLocalToUtc(2026, 10, 25, 2, 30)).toBe('2026-10-25T00:30:00Z');
  });
  it('around the March switch forward (29 Mar 2026)', () => {
    expect(amsterdamLocalToUtc(2026, 3, 28, 23, 59)).toBe('2026-03-28T22:59:00Z');
    expect(amsterdamLocalToUtc(2026, 3, 29, 3, 30)).toBe('2026-03-29T01:30:00Z');
    expect(amsterdamLocalToUtc(2026, 3, 29, 2, 30)).toBeNull(); // does not exist
  });
  it('printed date/time formats', () => {
    expect(printedToUtc('10-10-2026', '20:47')).toBe('2026-10-10T18:47:00Z');
    expect(printedToUtc('10/10/26', '20:47:05')).toBe('2026-10-10T18:47:05Z');
    expect(printedToUtc('10.10.2026', '8:05')).toBe('2026-10-10T06:05:00Z');
    expect(printedToUtc('2026-10-10', '20:47')).toBe('2026-10-10T18:47:00Z');
    expect(printedToUtc('31-02-2026', '12:00')).toBeNull();
    expect(printedToUtc('10-10-2026', '25:00')).toBeNull();
    expect(printedToUtc('gisteren', '12:00')).toBeNull();
  });
});

describe('Qianfan prompts', () => {
  it('are the two fixed Appendix A strings', () => {
    expect(QIANFAN_PROMPTS.markdown).toBe('Parse this document to Markdown.');
    expect(QIANFAN_PROMPTS.kie).toBe(
      'Extract from this Dutch receipt as JSON: merchant_name, kvk_number, btw_number, postcode, date, time, lines[{description, qty, unit_price, total, btw_rate}], btw_breakdown[{rate, base, btw}], total, rounding, payment_method. Use null for missing fields. Copy numbers exactly as printed.',
    );
  });
});
