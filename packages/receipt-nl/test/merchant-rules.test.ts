import { describe, expect, it } from 'vitest';
import { LINE_CATEGORIES } from '@lr/schema';
import { CATEGORY_RULES, categoriseLine, categoriseLines, categoriseMerchant, FALLBACK_CATEGORY, MERCHANT_RULES } from '../src/index.ts';

describe('categoriseMerchant (shop-type fallback)', () => {
  const shops: Array<[string, string, boolean]> = [
    ['Albert Heijn', 'boodschappen', false],
    ['AH', 'boodschappen', false],
    ['AH to go Utrecht Centraal', 'boodschappen', false],
    ['Jumbo Supermarkten', 'boodschappen', false],
    ['LIDL', 'boodschappen', false],
    ['Aldi', 'boodschappen', false],
    ['Plus Van der Meer', 'boodschappen', false],
    ['Dirk van den Broek', 'boodschappen', false],
    ['HEMA', 'huishouden', false],
    ['Action Nederland', 'huishouden', false],
    ['Blokker', 'huishouden', false],
    ['Shell Express', 'vervoer', false],
    ['BP', 'vervoer', false],
    ['Esso', 'vervoer', false],
    ['NS Reizigers', 'vervoer', false],
    ['Kruidvat', 'gezondheid', true],
    ['Etos', 'gezondheid', true],
    ['Apotheek Het Plein', 'gezondheid', true],
    ['H&M', 'kleding', false],
    ['McDonald’s', 'dining', false],
  ];
  it.each(shops)('%s → %s (sensitive: %s)', (name, category, sensitive) => {
    expect(categoriseMerchant(name)).toEqual({ category, sensitive });
  });

  it('is case-, accent- and punctuation-insensitive: "Albert Heijn" and "AH" are the same shop', () => {
    const expected = categoriseMerchant('Albert Heijn');
    expect(expected).toEqual({ category: 'boodschappen', sensitive: false });
    for (const variant of ['albert heijn', 'ALBERT HEIJN', 'Albert-Heijn', '  Albert   Heijn  ', 'AH', 'ah']) {
      expect(categoriseMerchant(variant), variant).toEqual(expected);
    }
    expect(categoriseMerchant('Café Zoë Apotheek')).toEqual({ category: 'gezondheid', sensitive: true });
    expect(categoriseMerchant('KRUIDVAT')).toEqual({ category: 'gezondheid', sensitive: true });
  });

  it('matches whole words only: "ah" or "bp" inside another word is not a shop', () => {
    expect(categoriseMerchant('Bakkerij Kahn')).toBeNull();
    expect(categoriseMerchant('Bpxyz Holding')).toBeNull();
    expect(categoriseMerchant('Snackbar De Frietzak')).toBeNull();
    expect(categoriseMerchant('Actionfilm Verhuur')).toBeNull();
  });

  it('unknown, empty and missing names have no category', () => {
    expect(categoriseMerchant('Café Het Plein')).toBeNull();
    expect(categoriseMerchant('')).toBeNull();
    expect(categoriseMerchant(null)).toBeNull();
    expect(categoriseMerchant(undefined)).toBeNull();
  });

  it('only uses categories the wallet offers', () => {
    for (const rule of MERCHANT_RULES) expect(LINE_CATEGORIES, rule.category).toContain(rule.category);
  });
});

describe('precedence: line keywords > shop name > overig', () => {
  it('a line keyword beats the shop name', () => {
    expect(categoriseLine({ description: 'Wasmiddel', merchantName: 'Albert Heijn' })).toEqual({ category: 'huishouden', sensitive: false });
    expect(categoriseLine({ description: 'Koffie', merchantName: 'HEMA' })).toEqual({ category: 'dining', sensitive: false });
    expect(categoriseLine({ description: 'Benzine', merchantName: 'Albert Heijn' })).toEqual({ category: 'vervoer', sensitive: false });
    expect(categoriseLine({ description: 'Shampoo', merchantName: 'Kruidvat' })).toEqual({ category: 'huishouden', sensitive: false });
    expect(categoriseLine({ description: 'Paracetamol', merchantName: 'Albert Heijn' })).toEqual({ category: 'gezondheid', sensitive: true });
  });

  it('a line no keyword matches takes the shop category', () => {
    expect(categoriseLine({ description: 'Iets onbekends', merchantName: 'Albert Heijn' })).toEqual({ category: 'boodschappen', sensitive: false });
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: 'AH' })).toEqual({ category: 'boodschappen', sensitive: false });
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: 'Blokker' })).toEqual({ category: 'huishouden', sensitive: false });
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: 'Shell' })).toEqual({ category: 'vervoer', sensitive: false });
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: 'Kruidvat' })).toEqual({ category: 'gezondheid', sensitive: true });
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: 'Etos' })).toEqual({ category: 'gezondheid', sensitive: true });
  });

  it('an unknown shop and no shop both fall back to overig', () => {
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: 'Café Het Plein' })).toEqual({ category: FALLBACK_CATEGORY, sensitive: false });
    expect(categoriseLine({ description: 'Artikel 4711' })).toEqual({ category: FALLBACK_CATEGORY, sensitive: false });
    expect(categoriseLine({ description: 'Artikel 4711', merchantName: null })).toEqual({ category: FALLBACK_CATEGORY, sensitive: false });
  });

  it('the category list of the schema is exactly the rule categories plus overig', () => {
    expect([...LINE_CATEGORIES].sort()).toEqual([...CATEGORY_RULES.map((r) => r.category), FALLBACK_CATEGORY].sort());
  });
});

describe('categoriseLines (stored per line; the buyer’s choice wins)', () => {
  const lines = [
    { description: 'Halfvolle melk', total: 129 },
    { description: 'Artikel 4711', total: 500 },
    { description: 'Paracetamol', total: 450 },
  ];

  it('stores category and sensitive on every line', () => {
    expect(categoriseLines(lines, 'Kruidvat').map((l) => [l.category, l.sensitive])).toEqual([
      ['boodschappen', false],
      ['gezondheid', true],
      ['gezondheid', true],
    ]);
  });

  it('keeps a user-set category on every later pass, and never flags it sensitive', () => {
    const first = categoriseLines(lines, 'Kruidvat');
    const edited = first.map((l, i) => (i === 2 ? { ...l, userCategory: 'dining' } : l));
    const again = categoriseLines(edited, 'Albert Heijn');
    // the shop changed, so the rule-based line moved; the line the buyer set did not
    expect(again.map((l) => l.category)).toEqual(['boodschappen', 'boodschappen', 'dining']);
    expect(again[2]).toMatchObject({ userCategory: 'dining', sensitive: false });
    // even a health keyword at a pharmacy does not override or flag the buyer's choice
    const pharmacy = categoriseLines([{ description: 'Paracetamol', total: 450, userCategory: 'overig' }], 'Apotheek Het Plein');
    expect(pharmacy[0]).toMatchObject({ category: 'overig', sensitive: false });
  });

  it('a cleared choice (null) is derived by the rules again', () => {
    const [line] = categoriseLines([{ description: 'Paracetamol', total: 450, userCategory: null }], null);
    expect(line).toMatchObject({ category: 'gezondheid', sensitive: true });
  });

  it('does not mutate its input', () => {
    const input = [{ description: 'Koffie', total: 1 }];
    categoriseLines(input, null);
    expect(input).toEqual([{ description: 'Koffie', total: 1 }]);
  });
});
