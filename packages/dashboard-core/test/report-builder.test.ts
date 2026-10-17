import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReportView, deleteReportView, listReportViews, previousPeriod, runReport } from '../src/index.ts';
import { BIER, fixture, KOFFIE, seedSales, seedTerminal, userWithRole, WIJN, type Fixture } from './helpers.ts';

let f: Fixture;
let terminalId: string;
beforeAll(async () => {
  f = await fixture('dc_report_builder');
  const t = await seedTerminal(f, 0);
  terminalId = t.terminalId;
  await seedSales(f, 0, t, [
    // 2026-03-10 (CET): R1 card 1069, R2 cash 729 (+1 rounding), R4 paid then voided 340
    { at: '2026-03-10T11:00:00Z', lines: [{ ...KOFFIE, qty: 2 }, BIER], steps: ['pay-card'] },
    { at: '2026-03-10T12:00:00Z', lines: [KOFFIE, BIER], steps: ['pay-cash'] },
    { at: '2026-03-10T14:00:00Z', lines: [KOFFIE], steps: ['pay-card', 'void'] },
    // 2026-03-11
    { at: '2026-03-11T10:00:00Z', lines: [WIJN], steps: ['pay-card'] },
    // 01:30 on 2026-04-01 in Amsterdam
    { at: '2026-03-31T23:30:00Z', lines: [KOFFIE], steps: ['pay-card'] },
    // 2026-04-02 (CEST)
    { at: '2026-04-02T10:00:00Z', lines: [{ ...BIER, qty: 2 }], steps: ['pay-card'] },
  ]);
  const t1 = await seedTerminal(f, 1);
  await seedSales(f, 1, t1, [{ at: '2026-03-10T11:00:00Z', lines: [{ ...WIJN, qty: 10 }], steps: ['pay-card'] }]);
});
afterAll(() => f.close());

const range = { from: '2026-03-01', to: '2026-04-30' };

describe('runReport', () => {
  it('groups by day with the chosen metrics only, plus totals', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    const r = await runReport(f.dash.db, actor, { ...range, groupBy: 'day', metrics: ['receipts', 'gross', 'cancelled'] });
    expect(r.rows.map((x) => [x.key, x.values])).toEqual([
      ['2026-03-10', { receipts: 2, gross: 1798, cancelled: 1 }],
      ['2026-03-11', { receipts: 1, gross: 495, cancelled: 0 }],
      ['2026-04-01', { receipts: 1, gross: 340, cancelled: 0 }],
      ['2026-04-02', { receipts: 1, gross: 778, cancelled: 0 }],
    ]);
    expect(r.totals).toEqual({ receipts: 5, gross: 3411, cancelled: 1 });
    expect(Object.keys(r.rows[0]!.values)).not.toContain('net');
  });

  it('average ticket is gross per paid receipt, rounded', async () => {
    const { actor } = await userWithRole(f, 0, 'manager');
    const r = await runReport(f.dash.db, actor, { ...range, groupBy: 'month', metrics: ['receipts', 'gross', 'avgTicket'] });
    expect(r.rows.map((x) => [x.key, x.values.receipts, x.values.gross, x.values.avgTicket])).toEqual([
      ['2026-03', 3, 2293, 764],
      ['2026-04', 2, 1118, 559],
    ]);
    expect(r.totals.avgTicket).toBe(Math.round(3411 / 5));
  });

  it('by VAT rate (from the signed VAT rows) and by payment method', async () => {
    const { actor } = await userWithRole(f, 0, 'accountant');
    const vat = await runReport(f.dash.db, actor, { ...range, groupBy: 'vat_rate', metrics: ['receipts', 'gross', 'net', 'vat'] });
    expect(vat.rows.map((x) => [x.key, x.values.receipts, x.values.gross])).toEqual([
      ['21', 4, 2051],
      ['9', 3, 1360],
    ]);
    expect(vat.rows.reduce((s, x) => s + (x.values.gross ?? 0), 0)).toBe(3411);
    const pay = await runReport(f.dash.db, actor, { ...range, groupBy: 'payment', metrics: ['receipts', 'gross'] });
    expect(Object.fromEntries(pay.rows.map((x) => [x.key, x.values.gross]))).toEqual({ card: 2682, cash: 730 });
    expect(pay.notes.some((n) => n.startsWith('partial:payment'))).toBe(false);
    const partial = await runReport(f.dash.db, actor, { ...range, groupBy: 'payment', metrics: ['gross', 'vat'] });
    expect(partial.notes).toContain('partial:payment:vat');
  });

  it('by hour, weekday, location and terminal', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    const hour = await runReport(f.dash.db, actor, { ...range, groupBy: 'hour', metrics: ['receipts'] });
    // Amsterdam wall-clock hours: R1 12:00, R2 13:00, the voided one 15:00, wine 11:00, coffee 01:30, the last beer 12:00 (CEST)
    expect(hour.rows.map((x) => [x.key, x.values.receipts])).toEqual([['01', 1], ['11', 1], ['12', 2], ['13', 1], ['15', 0]]);
    const weekday = await runReport(f.dash.db, actor, { ...range, groupBy: 'weekday', metrics: ['receipts'] });
    expect(weekday.rows.reduce((s, x) => s + (x.values.receipts ?? 0), 0)).toBe(5);
    const loc = await runReport(f.dash.db, actor, { ...range, groupBy: 'location', metrics: ['gross'] });
    expect(loc.rows).toHaveLength(1);
    expect(loc.rows[0]).toMatchObject({ key: f.orgs[0]!.locationId, label: 'Loc 0' });
    expect(loc.rows[0]!.values.gross).toBe(3411);
    const term = await runReport(f.dash.db, actor, { ...range, groupBy: 'terminal', metrics: ['gross'] });
    expect(term.rows[0]!.key).toBe(terminalId);
  });

  it('filters by payment method, location and terminal; another organisation never leaks in', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    const cash = await runReport(f.dash.db, actor, { ...range, groupBy: 'day', metrics: ['receipts', 'gross'], payment: 'cash' });
    expect(cash.totals).toEqual({ receipts: 1, gross: 729 });
    const other = await runReport(f.dash.db, actor, { ...range, groupBy: 'day', metrics: ['gross'], locationId: f.orgs[1]!.locationId });
    expect(other.rows).toEqual([]);
    expect(other.totals).toEqual({ gross: 0 });
    const mine = await runReport(f.dash.db, actor, { ...range, groupBy: 'day', metrics: ['gross'], terminalId });
    expect(mine.totals.gross).toBe(3411);
  });

  it('compares with the period just before, and sorts as asked', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    const r = await runReport(f.dash.db, actor, { from: '2026-04-01', to: '2026-04-30', groupBy: 'day', metrics: ['gross'], compare: true, sort: { by: 'gross', dir: 'desc' } });
    expect(r.previous).toMatchObject({ from: '2026-03-02', to: '2026-03-31' });
    expect(r.previous?.totals.gross).toBe(2293);
    expect(r.rows.map((x) => x.key)).toEqual(['2026-04-02', '2026-04-01']);
  });

  it('refuses a bad request', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    for (const bad of [{ ...range, metrics: [] }, { ...range, metrics: ['gross'], groupBy: 'colour' }, { from: '2026-05-01', to: '2026-04-01', metrics: ['gross'] }, { ...range, metrics: ['gross', 'gross'] }, { ...range, metrics: ['gross'], extra: 1 }]) {
      await expect(runReport(f.dash.db, actor, bad)).rejects.toMatchObject({ code: 'validation' });
    }
  });

  it('previousPeriod is as long as the period and ends the day before it', () => {
    expect(previousPeriod('2026-03-10', '2026-03-10')).toEqual({ from: '2026-03-09', to: '2026-03-09' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });
});

describe('saved views', () => {
  it('are shared inside the organisation, isolated between organisations, and deletable', async () => {
    const { actor: owner } = await userWithRole(f, 0, 'owner');
    const { actor: accountant } = await userWithRole(f, 0, 'accountant');
    const { actor: outsider } = await userWithRole(f, 1, 'owner');
    const spec = { ...range, groupBy: 'day' as const, metrics: ['gross' as const, 'receipts' as const], compare: false };
    const made = await createReportView(f.dash.db, owner, { name: 'Daily sales', spec });
    expect(made).toMatchObject({ name: 'Daily sales', spec: { groupBy: 'day' } });
    expect((await listReportViews(f.dash.db, accountant)).map((v) => v.name)).toContain('Daily sales');
    expect(await listReportViews(f.dash.db, outsider)).toEqual([]);
    await expect(deleteReportView(f.dash.db, outsider, made.id)).rejects.toMatchObject({ code: 'not_found' });
    await deleteReportView(f.dash.db, accountant, made.id);
    expect((await listReportViews(f.dash.db, owner)).map((v) => v.id)).not.toContain(made.id);
  });

  it('refuses an invalid spec or an empty name', async () => {
    const { actor } = await userWithRole(f, 0, 'owner');
    await expect(createReportView(f.dash.db, actor, { name: '', spec: { ...range, metrics: ['gross'] } })).rejects.toMatchObject({ code: 'validation' });
    await expect(createReportView(f.dash.db, actor, { name: 'x', spec: { ...range, metrics: [] } })).rejects.toMatchObject({ code: 'validation' });
  });
});
