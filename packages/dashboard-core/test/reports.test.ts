import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenError, salesReport, vatByDay } from '../src/index.ts';
import { BIER, fixture, KOFFIE, seedSales, seedTerminal, TAART, userWithRole, WIJN, type Fixture } from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await fixture('dc_reports');
  const t = await seedTerminal(f, 0);
  await seedSales(f, 0, t, [
    // 2026-03-10 (Amsterdam, CET): R1 card: 2×koffie@9% + bier@21%
    { at: '2026-03-10T11:00:00Z', lines: [{ ...KOFFIE, qty: 2 }, BIER], steps: ['present', 'pay-card'] },
    // R2 cash: koffie + bier = 729 → cash rounding +1
    { at: '2026-03-10T12:00:00Z', lines: [KOFFIE, BIER], steps: ['pay-cash'] },
    // R3 still a pre-bill: not a sale
    { at: '2026-03-10T13:00:00Z', lines: [TAART], steps: ['present'] },
    // R4 paid, then voided
    { at: '2026-03-10T14:00:00Z', lines: [KOFFIE], steps: ['pay-card', 'void'] },
    // 2026-03-11
    { at: '2026-03-11T10:00:00Z', lines: [WIJN], steps: ['pay-card'] },
    // 2026-04-02 (CEST)
    { at: '2026-04-02T10:00:00Z', lines: [{ ...BIER, qty: 2 }], steps: ['pay-card'] },
    // 23:30 UTC on 2026-03-31 is 01:30 on 2026-04-01 in Amsterdam
    { at: '2026-03-31T23:30:00Z', lines: [KOFFIE], steps: ['pay-card'] },
  ]);
  // another org's sale must never show up
  const t1 = await seedTerminal(f, 1);
  await seedSales(f, 1, t1, [{ at: '2026-03-10T11:00:00Z', lines: [{ ...WIJN, qty: 10 }], steps: ['pay-card'] }]);
});
afterAll(() => f.close());

describe('salesReport (hand-computed)', () => {
  it('daily sales, rounding and voids', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    const r = await salesReport(f.dash.db, actor, { from: '2026-03-01', to: '2026-04-30' });
    // 03-10: R1 1069 + R2 729 = 1798. net: (624+321) + (312+321) = 1578. vat: (56+68) + (28+68) = 220
    // 03-11: wijn 495: vat 86, net 409. 04-01: koffie 340: vat 28, net 312. 04-02: 2 bier 778: vat 135, net 643
    expect(r.sales).toEqual([
      { period: '2026-03-10', receipts: 2, gross: 1798, net: 1578, vat: 220, tip: 0, rounding: 1, voids: 1, voidGross: 340 },
      { period: '2026-03-11', receipts: 1, gross: 495, net: 409, vat: 86, tip: 0, rounding: 0, voids: 0, voidGross: 0 },
      { period: '2026-04-01', receipts: 1, gross: 340, net: 312, vat: 28, tip: 0, rounding: 0, voids: 0, voidGross: 0 },
      { period: '2026-04-02', receipts: 1, gross: 778, net: 643, vat: 135, tip: 0, rounding: 0, voids: 0, voidGross: 0 },
    ]);
  });

  it('monthly sales use Amsterdam days (23:30Z on 31 March belongs to April)', async () => {
    const { actor } = await userWithRole(f, 0, 'manager');
    const r = await salesReport(f.dash.db, actor, { from: '2026-03-01', to: '2026-04-30', granularity: 'month' });
    expect(r.sales).toEqual([
      { period: '2026-03', receipts: 3, gross: 2293, net: 1987, vat: 306, tip: 0, rounding: 1, voids: 1, voidGross: 340 },
      { period: '2026-04', receipts: 2, gross: 1118, net: 955, vat: 163, tip: 0, rounding: 0, voids: 0, voidGross: 0 },
    ]);
  });

  it('BTW per rate', async () => {
    const { actor } = await userWithRole(f, 0, 'accountant');
    const r = await salesReport(f.dash.db, actor, { from: '2026-03-10', to: '2026-03-10' });
    // 21%: bier 389 on R1 and R2: vat 68 each (rounded per receipt and rate) = 136; gross 778, net 642
    expect(r.vatByRate).toEqual([
      { period: '2026-03-10', rate: 21, gross: 778, net: 642, vat: 136 },
      { period: '2026-03-10', rate: 9, gross: 1020, net: 936, vat: 84 },
    ]);
  });

  it('filters by date range and agrees with vatByDay', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    const r = await salesReport(f.dash.db, actor, { from: '2026-03-11', to: '2026-03-11' });
    expect(r.sales.map((s) => s.period)).toEqual(['2026-03-11']);
    const v = await vatByDay(f.dash.db, actor.orgId, '2026-03-10', '2026-03-10');
    expect(v.map((x) => [x.rate, x.gross, x.vat])).toEqual([
      [21, 778, 136],
      [9, 1020, 84],
    ]);
  });

  it('only counts the caller organisation', async () => {
    const { actor } = await userWithRole(f, 1, 'owner');
    const r = await salesReport(f.dash.db, actor, { from: '2026-03-01', to: '2026-04-30' });
    expect(r.sales).toHaveLength(1);
    expect(r.sales[0]).toMatchObject({ receipts: 1, gross: 4950 });
  });

  it('is readable by an accountant and rejects malformed dates', async () => {
    const { actor } = await userWithRole(f, 0, 'accountant');
    await expect(salesReport(f.dash.db, actor, { from: '2026/03/01', to: '2026-04-30' })).rejects.toMatchObject({ code: 'validation' });
    await expect(salesReport(f.dash.db, { ...actor, role: 'owner' }, { from: '2026-03-01', to: '2026-03-01' })).resolves.toBeDefined();
    expect(ForbiddenError).toBeDefined();
  });
});
