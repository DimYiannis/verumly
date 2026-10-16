import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, withOrg } from '@lr/db';
import { getReceiptWithVersions, receiptPdf, searchArchive } from '../src/index.ts';
import { BIER, fixture, KOFFIE, seedSales, seedTerminal, WIJN, type Fixture } from './helpers.ts';

let f: Fixture;
let ids0: string[];
let ids1: string[];
beforeAll(async () => {
  f = await fixture('dc_arch');
  ids0 = await seedSales(f, 0, await seedTerminal(f, 0), [
    { at: '2026-03-10T11:00:00Z', lines: [KOFFIE, BIER], steps: ['present', 'pay-card'] },
    { at: '2026-03-11T11:00:00Z', lines: [WIJN], steps: ['pay-cash'] },
  ]);
  ids1 = await seedSales(f, 1, await seedTerminal(f, 1), [{ at: '2026-03-10T11:00:00Z', lines: [{ ...BIER, description: 'Bier geheim' }], steps: ['pay-card'] }]);
});
afterAll(() => f.close());

describe('archive', () => {
  it('searches with filters', async () => {
    const all = await searchArchive(f.dash.db, f.orgs[0]!.id);
    expect(all.map((r) => r.id)).toEqual([ids0[1], ids0[0]]); // newest first
    expect(all[0]).toMatchObject({ state: 'paid', totalMinor: 495, locationName: 'Loc 0' });
    expect((await searchArchive(f.dash.db, f.orgs[0]!.id, { q: 'koffie' })).map((r) => r.id)).toEqual([ids0[0]]);
    expect((await searchArchive(f.dash.db, f.orgs[0]!.id, { amount: 495 })).map((r) => r.id)).toEqual([ids0[1]]);
    expect((await searchArchive(f.dash.db, f.orgs[0]!.id, { from: '2026-03-11', to: '2026-03-11' })).map((r) => r.id)).toEqual([ids0[1]]);
    expect(await searchArchive(f.dash.db, f.orgs[0]!.id, { state: 'void' })).toEqual([]);
  });

  it('returns versions and a PDF', async () => {
    const r = await getReceiptWithVersions(f.dash.db, f.orgs[0]!.id, ids0[0]!);
    expect(r?.versions.map((v) => [v.version, v.state])).toEqual([
      [1, 'presented'],
      [2, 'paid'],
    ]);
    const pdf = await receiptPdf(r!.versions[1]!.crf);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
  });

  it('RLS: org A never sees org B, by search, by id, or by raw SQL', async () => {
    const a = f.orgs[0]!.id;
    const b = f.orgs[1]!.id;
    expect((await searchArchive(f.dash.db, a, { q: 'geheim' })).length).toBe(0);
    expect((await searchArchive(f.dash.db, b, { q: 'geheim' })).map((r) => r.id)).toEqual(ids1);
    expect(await getReceiptWithVersions(f.dash.db, a, ids1[0]!)).toBeNull();
    expect((await getReceiptWithVersions(f.dash.db, b, ids1[0]!))?.id).toBe(ids1[0]);
    const counts = await withOrg(f.dash.db, a, async (tx) => {
      const r = await tx.execute<{ r: string; v: string; l: string }>(
        sql`select (select count(*) from merchant.receipts) r, (select count(*) from merchant.receipt_versions) v, (select count(*) from merchant.receipt_lines) l`,
      );
      return r.rows[0];
    });
    expect(counts).toEqual({ r: '2', v: '3', l: '3' });
    // no org context at all: nothing is visible
    const none = await f.dash.db.execute<{ n: string }>(sql`select count(*) n from merchant.receipts`);
    expect(none.rows[0]?.n).toBe('0');
  });

  it('the dashboard role cannot read any buyer table', async () => {
    for (const t of ['users', 'sessions', 'claims', 'uploads', 'consents', 'email_codes', 'push_subscriptions']) {
      await expect(f.dash.db.execute(sql.raw(`select * from buyer.${t}`))).rejects.toThrow();
    }
  });
});
