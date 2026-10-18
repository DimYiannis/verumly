import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { btwAccountantCsv, salesReport, vatByDay } from '../src/index.ts';
import { fixture, seedSales, seedTerminal, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
const DE = 2;
const FR = 3;

beforeAll(async () => {
  f = await fixture('dc_countries');
  const de = await seedTerminal(f, DE);
  await seedSales(f, DE, de, [
    // paid, then fiscalised by the (sandbox) TSE: the receipt ends in `fiscalised` and is still a sale
    { at: '2026-05-04T10:00:00Z', lines: [{ description: 'Kaffee', unitPrice: 340, vatRate: 7 }, { description: 'Bier', unitPrice: 400, vatRate: 19 }], steps: ['pay-card'] },
    { at: '2026-05-04T12:00:00Z', lines: [{ description: 'Kaffee', unitPrice: 340, vatRate: 7 }], steps: ['pay-card', 'void'] },
  ]);
  const fr = await seedTerminal(f, FR);
  await seedSales(f, FR, fr, [
    { at: '2026-05-04T10:00:00Z', lines: [{ description: 'Baguette', unitPrice: 1055, vatRate: 5.5 }, { description: 'Vin', unitPrice: 1200, vatRate: 20 }], steps: ['pay-card'] },
  ]);
});
afterAll(() => f.close());

describe('reports of a business with a fiscal step (DE)', () => {
  it('a fiscalised receipt is a sale; the voided one is a void; VAT per German rate', async () => {
    const { actor } = await userWithRole(f, DE, 'owner');
    const r = await salesReport(f.dash.db, actor, { from: '2026-05-01', to: '2026-05-31' });
    // gross 340 + 400; vat: round(340·7/107) = 22, round(400·19/119) = 64
    expect(r.sales).toEqual([{ period: '2026-05-04', receipts: 1, gross: 740, net: 654, vat: 86, tip: 0, rounding: 0, voids: 1, voidGross: 340 }]);
    expect(r.vatByRate).toEqual([
      { period: '2026-05-04', rate: 19, gross: 400, net: 336, vat: 64 },
      { period: '2026-05-04', rate: 7, gross: 340, net: 318, vat: 22 },
    ]);
  });

  it('the stored receipt really is fiscalised, with the TSE data', async () => {
    const res = await f.admin.execute<{ state: string; extra: Record<string, string> }>(sql`
      select r.state, v.payload->'fiscal'->'extra' as extra
      from merchant.receipts r join merchant.receipt_versions v on v.receipt_id = r.id and v.version = r.current_version
      where r.org_id = ${f.orgs[DE]!.id}::uuid order by r.state`);
    const states = res.rows;
    expect(states.map((x) => x.state)).toEqual(['fiscalised', 'void']);
    expect(states[0]!.extra).toMatchObject({ mode: 'sandbox' });
    expect(Object.keys(states[0]!.extra)).toEqual(expect.arrayContaining(['tseSerial', 'transactionNumber', 'signatureCounter', 'signature']));
  });
});

describe('reports with decimal VAT rates (FR 5.5%)', () => {
  it('sales report and VAT per day keep 5.5 as 5.5', async () => {
    const { actor } = await userWithRole(f, FR, 'accountant');
    const r = await salesReport(f.dash.db, actor, { from: '2026-05-04', to: '2026-05-04' });
    expect(r.vatByRate).toEqual([
      { period: '2026-05-04', rate: 20, gross: 1200, net: 1000, vat: 200 },
      { period: '2026-05-04', rate: 5.5, gross: 1055, net: 1000, vat: 55 },
    ]);
    const days = await vatByDay(f.dash.db, actor.orgId, '2026-05-04', '2026-05-04');
    expect(days.map((d) => [d.rate, d.vat])).toEqual([[20, 200], [5.5, 55]]);
  });

  it('the accountant CSV lists every rate of the period; the Dutch return boxes stay empty', async () => {
    const { actor } = await userWithRole(f, FR, 'owner');
    const days = await vatByDay(f.dash.db, actor.orgId, '2026-05-04', '2026-05-04');
    const csv = btwAccountantCsv(days, '2026-05-04', '2026-05-04');
    expect(csv.split('\n')).toEqual([
      'scope,period,vat_return_box,rate,gross_cents,net_cents,vat_cents,receipts',
      'day,2026-05-04,,20,1200,1000,200,1',
      'day,2026-05-04,,5.5,1055,1000,55,1',
      'period,2026-05-04..2026-05-04,,20,1200,1000,200,1',
      'period,2026-05-04..2026-05-04,,5.5,1055,1000,55,1',
      '',
    ]);
  });
});
