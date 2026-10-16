import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, newReceiptId } from '@lr/crypto';
import { categoriseLine, CATEGORY_RULES } from '@lr/receipt-nl';
import { buildCrf, sql, submit } from '../../../scripts/lib/testkit.ts';
import { categorise } from '../src/jobs/categorise.ts';
import { createWorkerWorld, type WorkerWorld } from './helpers.ts';

describe('categoriser rules (Dutch keywords)', () => {
  const cases: Array<[string, string, boolean]> = [
    ['Koffie', 'dining', false],
    ['Appeltaart', 'dining', false],
    ['Bier flesje', 'dining', false],
    ['Halfvolle melk 1L', 'boodschappen', false],
    ['Volkoren brood', 'boodschappen', false],
    ['Wasmiddel', 'huishouden', false],
    ['Statiegeld fles', 'statiegeld', false],
    ['Parkeerkaart', 'vervoer', false],
    ['Paracetamol 500mg', 'gezondheid', true],
    ['Ibuprofen 400', 'gezondheid', true],
    ['Iets onbekends', 'overig', false],
    ['KOFFIE', 'dining', false],
  ];
  it.each(cases)('%s → %s (sensitive: %s)', (description, category, sensitive) => {
    expect(categoriseLine({ description })).toEqual({ category, sensitive });
  });

  it('every line at an apotheek is health (sensitive); at a drogist only health products are', () => {
    expect(categoriseLine({ description: 'Tandenstokers', merchantName: 'Apotheek De Linde' })).toEqual({ category: 'gezondheid', sensitive: true });
    expect(categoriseLine({ description: 'Shampoo', merchantName: 'Drogisterij Kruidvat' })).toEqual({ category: 'huishouden', sensitive: false });
    expect(categoriseLine({ description: 'Neusspray', merchantName: 'Drogisterij Kruidvat' })).toEqual({ category: 'gezondheid', sensitive: true });
  });

  it('the rule table has no duplicate category names; a keyword always resolves to its own or an earlier category, and sensitive means health', () => {
    const names = CATEGORY_RULES.map((r) => r.category);
    expect(new Set(names).size).toBe(names.length);
    CATEGORY_RULES.forEach((rule, i) => {
      for (const k of rule.keywords) {
        const verdict = categoriseLine({ description: k });
        expect(names.indexOf(verdict.category), k).toBeLessThanOrEqual(i);
        expect(verdict.sensitive, k).toBe(verdict.category === 'gezondheid');
      }
    });
  });
});

describe('categorise job', () => {
  let ww: WorkerWorld;
  beforeAll(async () => {
    ww = await createWorkerWorld();
  }, 120_000);
  afterAll(async () => {
    await ww.close();
  });

  it('fills null categories, keeps terminal-supplied ones, flags health lines, and is a no-op the second time', async () => {
    const org = ww.w.orgA;
    const pharmacy = newReceiptId();
    const crf = buildCrf({
      receiptId: pharmacy,
      version: 1,
      state: 'paid',
      org,
      lines: [
        { description: 'Paracetamol', unitPrice: 450, vatRate: 9 },
        { description: 'Pleisters', unitPrice: 300, vatRate: 9 },
        { description: 'Koffie', unitPrice: 340, vatRate: 9 },
      ],
    });
    // a merchant named apotheek; one line already categorised by the terminal
    const named = { ...crf, merchant: { ...crf.merchant, name: 'Apotheek Het Plein' }, lines: crf.lines.map((l, i) => (i === 2 ? { ...l, category: 'terminal-choice' } : l)) };
    expect((await submit(ww.w.merchant, org, named, { secret: generateSecret() })).status).toBe(201);

    const cafe = newReceiptId();
    const cafeCrf = buildCrf({ receiptId: cafe, version: 1, state: 'paid', org, lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9 }, { description: 'Onbekend ding', unitPrice: 100, vatRate: 21 }, { description: 'Shampoo', unitPrice: 200, vatRate: 21 }] });
    expect((await submit(ww.w.merchant, org, cafeCrf, { secret: generateSecret() })).status).toBe(201);

    const first = await categorise(ww.ctx);
    expect(first.lines).toBeGreaterThanOrEqual(5);
    const lines = await sql<{ receipt_id: string; description: string; category: string; sensitive: boolean }>(ww.w, 'select receipt_id, description, category, sensitive from merchant.receipt_lines order by receipt_id, line_no');
    const byDesc = (id: string, d: string) => lines.find((l) => l.receipt_id === id && l.description === d);
    // the terminal's own category is stored by ingest and never overwritten
    expect(byDesc(pharmacy, 'Koffie')).toMatchObject({ category: 'terminal-choice', sensitive: false });
    // everything at an apotheek is health
    expect(byDesc(pharmacy, 'Paracetamol')).toMatchObject({ category: 'gezondheid', sensitive: true });
    expect(byDesc(pharmacy, 'Pleisters')).toMatchObject({ category: 'gezondheid', sensitive: true });
    expect(byDesc(cafe, 'Koffie')).toMatchObject({ category: 'dining', sensitive: false });
    expect(byDesc(cafe, 'Onbekend ding')).toMatchObject({ category: 'overig', sensitive: false });
    expect(byDesc(cafe, 'Shampoo')).toMatchObject({ category: 'huishouden', sensitive: false });

    const second = await categorise(ww.ctx);
    expect(second.lines).toBe(0);
  });
});
