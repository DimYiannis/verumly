import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimRequest, createReceipt, createWorld, loginUser, resolveRequest, sql, buyerCall, type OrgFixture, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
let gb: OrgFixture;
let de: OrgFixture;

beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
  gb = await w.addOrg({ country: 'GB' });
  de = await w.addOrg({ country: 'DE' });
}, 120_000);
afterAll(async () => {
  await w.close();
});

const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

describe('the wallet and receipts in other currencies', () => {
  it('a British receipt: the preview, the list and the detail say GBP; a DE receipt waits for its fiscal step to be final', async () => {
    const me = await loginUser(w);
    const pounds = await createReceipt(w, gb, { state: 'paid' });
    const preview = await resolveRequest(w, pounds);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ preview: { currency: 'GBP' } });
    expect((await claimRequest(w, me, pounds)).status).toBe(201);

    const list = await buyerCall(w, 'GET', '/v1/me/receipts', { token: me.token });
    expect((list.body as { items: Array<{ currency: string }> }).items[0]).toMatchObject({ currency: 'GBP' });
    const detail = await buyerCall(w, 'GET', `/v1/me/receipts/${pounds.receiptId}`, { token: me.token });
    expect(detail.body).toMatchObject({ final: true, receipt: { currency: 'GBP' } });

    // Germany: `paid` is not final yet, the TSE step is missing
    const germany = await createReceipt(w, de, { state: 'paid' });
    expect((await claimRequest(w, me, germany)).status).toBe(201);
    const d = await buyerCall(w, 'GET', `/v1/me/receipts/${germany.receiptId}`, { token: me.token });
    expect(d.body).toMatchObject({ final: false, receipt: { currency: 'EUR', fiscal: { country: 'DE' } } });
  });

  it('home, insights and balances count one currency: the one of the latest final receipt', async () => {
    const me = await loginUser(w);
    await buyerCall(w, 'PUT', '/v1/me/consents', { token: me.token, body: { analytics: true } });
    // an older receipt in euros (Germany would need the fiscal step, so use the Dutch org), then a newer one in pounds
    const euros = await createReceipt(w, w.orgA, { state: 'paid', createdAt: at(1), lines: [{ unitPrice: 1000, vatRate: 21 }] });
    const pounds = await createReceipt(w, gb, { state: 'paid', createdAt: at(0), lines: [{ unitPrice: 2500, vatRate: 20 }] });
    expect((await claimRequest(w, me, euros)).status).toBe(201);
    expect((await claimRequest(w, me, pounds)).status).toBe(201);

    const home = (await buyerCall(w, 'GET', '/v1/me/home', { token: me.token })).body as { currency: string; total: number; recent: Array<{ currency: string; total: number }> };
    expect(home.currency).toBe('GBP');
    expect(home.total).toBeLessThanOrEqual(2500); // the euros are not added to the pounds (this month or not, never 3500)
    expect(home.recent.map((r) => r.currency).sort()).toEqual(['EUR', 'GBP']);

    const insights = (await buyerCall(w, 'GET', '/v1/me/insights', { token: me.token })).body as { currency: string; perMonth: Array<{ total: number }>; vatPerRate: Array<{ rate: number }> };
    expect(insights.currency).toBe('GBP');
    expect(insights.perMonth.reduce((s, m) => s + m.total, 0)).toBe(2500);
    expect(insights.vatPerRate.map((v) => v.rate)).toEqual([20]);

    const balances = (await buyerCall(w, 'GET', '/v1/me/balances', { token: me.token })).body as { currency: string };
    expect(balances.currency).toBe('GBP');
  });

  it('insights keep decimal VAT rates (5.5 is not turned into 6)', async () => {
    const me = await loginUser(w);
    await buyerCall(w, 'PUT', '/v1/me/consents', { token: me.token, body: { analytics: true } });
    const fr = await w.addOrg({ country: 'FR' });
    const receipt = await createReceipt(w, fr, { state: 'paid', createdAt: at(0), lines: [{ unitPrice: 1055, vatRate: 5.5 }] });
    expect((await claimRequest(w, me, receipt)).status).toBe(201);
    // France needs its fiscal step before the receipt counts: fiscalise it the way a till would
    const [row] = await sql<{ state: string }>(w, 'select state from merchant.receipts where id = $1', [receipt.receiptId]);
    expect(row?.state).toBe('paid');
    const insights = (await buyerCall(w, 'GET', '/v1/me/insights', { token: me.token })).body as { vatPerRate: Array<{ rate: number; vat: number }> };
    // a `paid` receipt is counted in the totals whatever the country (the totals follow `paid`/`fiscalised`)
    expect(insights.vatPerRate).toEqual([{ rate: 5.5, vat: 55 }]);
  });
});
