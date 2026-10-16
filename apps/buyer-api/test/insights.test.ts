import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, newReceiptId } from '@lr/crypto';
import { buildCrf, buyerCall, claimRequest, createWorld, loginUser, sql, submit, type BuyerSession, type LineSpec, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

/** A receipt of `merchant` in `state`, claimed by `who`; line categories are set the way the worker's categoriser would. */
async function receipt(who: BuyerSession, o: { merchant: string; state: 'paid' | 'presented' | 'void'; createdAt: string; lines: LineSpec[]; categories?: Record<string, { category: string; sensitive?: boolean }> }) {
  const receiptId = newReceiptId();
  const secret = generateSecret();
  const crf = buildCrf({ receiptId, version: 1, state: o.state, org: w.orgA, lines: o.lines, createdAt: o.createdAt, voidOf: o.state === 'void' ? receiptId : null });
  const res = await submit(w.merchant, w.orgA, { ...crf, merchant: { ...crf.merchant, name: o.merchant } }, { secret });
  expect(res.status).toBe(201);
  expect((await claimRequest(w, who, { receiptId, secret })).status).toBe(201);
  for (const [description, c] of Object.entries(o.categories ?? {})) {
    await sql(w, 'update merchant.receipt_lines set category = $1, sensitive = $2 where receipt_id = $3 and description = $4', [c.category, c.sensitive ?? false, receiptId, description]);
  }
  return receiptId;
}

describe('GET /v1/me/insights', () => {
  it('spend per month, per category and top merchants; pre-bills, voids, other users and health categories are handled; uploads count', async () => {
    const me = await loginUser(w);
    const other = await loginUser(w);
    const dining = { category: 'dining' };

    await receipt(me, { merchant: 'Café Het Plein', state: 'paid', createdAt: '2026-08-15T10:00:00Z', lines: [{ description: 'Koffie', qty: '2', unitPrice: 340, vatRate: 9 }, { description: 'Bier', unitPrice: 389, vatRate: 21 }], categories: { Koffie: dining, Bier: dining } });
    await receipt(me, { merchant: 'Café Het Plein', state: 'paid', createdAt: '2026-09-03T10:00:00Z', lines: [{ description: 'Taart', unitPrice: 475, vatRate: 9 }], categories: { Taart: dining } });
    await receipt(me, { merchant: 'Apotheek Het Plein', state: 'paid', createdAt: '2026-09-20T10:00:00Z', lines: [{ description: 'Paracetamol', unitPrice: 450, vatRate: 9 }], categories: { Paracetamol: { category: 'gezondheid', sensitive: true } } });
    await receipt(me, { merchant: 'Café Het Plein', state: 'presented', createdAt: '2026-09-21T10:00:00Z', lines: [{ description: 'Koffie', unitPrice: 1000, vatRate: 9 }], categories: { Koffie: dining } });
    await receipt(other, { merchant: 'Andere Zaak', state: 'paid', createdAt: '2026-09-05T10:00:00Z', lines: [{ description: 'Duur ding', unitPrice: 9999, vatRate: 21 }] });
    // a finished upload of a paper receipt (the categoriser's rules apply to its lines at read time)
    const parsed = {
      status: 'done',
      failures: [],
      merchant: { name: 'Supermarkt X', kvkNumber: null, vatNumber: null, postcode: null },
      merchantKey: 'name:supermarkt x|',
      printedAtUtc: '2026-09-10T12:00:00.000Z',
      lines: [{ description: 'Halfvolle melk', qty: '1', unitPrice: 1500, total: 1500, vatRate: 9, kind: 'item' }],
      gross: 1500,
      rounding: 0,
      vatBreakdown: [{ rate: 9, base: 1376, vat: 124 }],
      paymentMethod: 'card',
    };
    await sql(w, "insert into buyer.uploads (user_id, s3_key, content_type, status, extracted) values ($1, 'uploads/i1', 'image/png', 'done', $2)", [me.userId, JSON.stringify({ parsed, failures: [], modelRevision: 'mock', corrected: false })]);
    // needs_review / replaced / failed uploads are not spending
    await sql(w, "insert into buyer.uploads (user_id, s3_key, content_type, status, extracted) values ($1, 'uploads/i2', 'image/png', 'needs_review', $2), ($1, 'uploads/i3', 'image/png', 'replaced', $2)", [me.userId, JSON.stringify({ parsed, failures: [], modelRevision: 'mock', corrected: false })]);

    const res = await buyerCall(w, 'GET', '/v1/me/insights', { token: me.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      // hand-computed: Aug 680+389; Sep 475+450 (paid receipts) + 1500 (upload); the pre-bill and the stranger do not count
      perMonth: [
        { month: '2026-08', total: 1069 },
        { month: '2026-09', total: 2425 },
      ],
      // the health line is reported as "overig": insights never reveal a health category
      perCategory: [
        { category: 'dining', total: 1544 },
        { category: 'boodschappen', total: 1500 },
        { category: 'overig', total: 450 },
      ],
      topMerchants: [
        { merchantName: 'Café Het Plein', total: 1544, count: 2 },
        { merchantName: 'Supermarkt X', total: 1500, count: 1 },
        { merchantName: 'Apotheek Het Plein', total: 450, count: 1 },
      ],
    });
    // nothing else is exposed
    expect(Object.keys(res.body as object).sort()).toEqual(['perCategory', 'perMonth', 'topMerchants']);
    expect(res.text).not.toContain('gezondheid');
  });

  it('a user with no data gets empty lists; a session is required', async () => {
    const empty = await loginUser(w);
    expect((await buyerCall(w, 'GET', '/v1/me/insights', { token: empty.token })).body).toEqual({ perMonth: [], perCategory: [], topMerchants: [] });
    expect((await buyerCall(w, 'GET', '/v1/me/insights')).status).toBe(401);
  });

  it('top merchants are limited to 10', async () => {
    const me = await loginUser(w);
    for (let i = 0; i < 12; i++) {
      await receipt(me, { merchant: `Zaak ${String(i).padStart(2, '0')}`, state: 'paid', createdAt: '2026-07-01T10:00:00Z', lines: [{ description: 'Ding', unitPrice: 100 + i, vatRate: 9 }] });
    }
    const body = (await buyerCall(w, 'GET', '/v1/me/insights', { token: me.token })).body as { topMerchants: Array<{ merchantName: string; total: number }> };
    expect(body.topMerchants).toHaveLength(10);
    expect(body.topMerchants[0]).toEqual({ merchantName: 'Zaak 11', total: 111, count: 1 });
  });
});
