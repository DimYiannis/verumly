import { describe, expect, it } from 'vitest';
import { cleanSettings, COUNTRY_CODES, getCountry, listCountries, validateSetup } from '../src/index.ts';

describe('country rules', () => {
  it('covers the EU member states plus the extras', () => {
    for (const c of ['NL', 'DE', 'FR', 'IT', 'ES', 'PT', 'PL', 'SE', 'EE', 'CY', 'MT', 'NO', 'CH', 'GB']) expect(COUNTRY_CODES).toContain(c);
    expect(listCountries().length).toBeGreaterThanOrEqual(30);
  });
  it('every country has a name, a currency, sources and an adviser note', () => {
    for (const c of listCountries()) {
      expect(c.name.length).toBeGreaterThan(2);
      expect(c.currency).toMatch(/^[A-Z]{3}$/);
      expect(c.sources.length, c.code).toBeGreaterThan(0);
      expect(c.adviserMustVerify.length, c.code).toBeGreaterThan(0);
      for (const s of c.settings) {
        if (s.pattern) expect(() => new RegExp(s.pattern!), `${c.code}.${s.key}`).not.toThrow();
        if (s.type === 'select') expect(s.options?.length, `${c.code}.${s.key}`).toBeGreaterThan(1);
      }
    }
  });
  it('is case-insensitive and null for unknown codes', () => {
    expect(getCountry('nl')?.name).toBe('Netherlands');
    expect(getCountry('XX')).toBeNull();
  });
});

describe('validateSetup', () => {
  it('accepts a valid Dutch identity', () => {
    expect(validateSetup('NL', { companyId: '12345678', vatId: 'NL123456789B01' }, {})).toEqual([]);
  });
  it('rejects a bad KvK and BTW id', () => {
    expect(validateSetup('NL', { companyId: '1234', vatId: 'NL12' }, {})).toHaveLength(2);
  });
  it('German setup asks for the TSE serial', () => {
    const e = validateSetup('DE', { companyId: null, vatId: 'DE123456789' }, {});
    expect(e.some((m) => m.includes('TSE'))).toBe(true);
  });
  it('unknown country is an error', () => {
    expect(validateSetup('XX', { companyId: null, vatId: null }, {})).toHaveLength(1);
  });
});

describe('cleanSettings', () => {
  it('keeps only known keys and coerces booleans', () => {
    const v = cleanSettings('DE', { tseSerial: ' AB12 ', tillRegisteredAt: 'true', nonsense: 'x' });
    expect(v).toMatchObject({ tseSerial: 'AB12', tillRegisteredAt: true });
    expect('nonsense' in v).toBe(false);
  });
});
