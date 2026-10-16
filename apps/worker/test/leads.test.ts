import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginUser, sql } from '../../../scripts/lib/testkit.ts';
import { corpusEntry, createWorkerWorld, orgForCorpusEntry, uploadAndExtract, type WorkerWorld } from './helpers.ts';

let ww: WorkerWorld;
beforeAll(async () => {
  ww = await createWorkerWorld({ leadThreshold: 2 });
}, 120_000);
afterAll(async () => {
  await ww.close();
});

const lead = (key: string) =>
  sql<{ status: string; distinct_uploaders: number; name: string | null }>(ww.w, 'select status, distinct_uploaders, name from leads.unknown_merchants where merchant_key = $1', [key]);

describe('leads from unknown merchants', () => {
  it('keyed by KvK when the BTW-id is missing; becomes `new` at the threshold of distinct uploaders', async () => {
    const e = corpusEntry(ww, 'mock-zonder-btw-id'); // prints a KvK but no BTW-id
    const key = `kvk:${e.truth.merchant.kvk}`;
    const first = await loginUser(ww.w);
    const second = await loginUser(ww.w);

    expect((await uploadAndExtract(ww, first, e)).outcome.lead).toBe('collecting');
    expect(await lead(key)).toEqual([{ status: 'collecting', distinct_uploaders: 1, name: 'Snackbar De Frietzak' }]);

    // the same person uploading again is still one uploader
    expect((await uploadAndExtract(ww, first, e)).outcome.lead).toBe('collecting');
    expect((await lead(key))[0]).toMatchObject({ status: 'collecting', distinct_uploaders: 1 });

    // a second distinct uploader reaches the threshold of 2
    expect((await uploadAndExtract(ww, second, e)).outcome.lead).toBe('new');
    expect(await lead(key)).toEqual([{ status: 'new', distinct_uploaders: 2, name: 'Snackbar De Frietzak' }]);
    const uploaders = await sql<{ n: number }>(ww.w, 'select count(*)::int n from leads.unknown_merchant_uploaders where merchant_key = $1', [key]);
    expect(uploaders[0]?.n).toBe(2);
  });

  it('keyed by BTW-id when present (vat:<id>)', async () => {
    const e = corpusEntry(ww, 'mock-weegschaal');
    const who = await loginUser(ww.w);
    await uploadAndExtract(ww, who, e);
    expect(await lead(`vat:${e.truth.merchant.vatNumber}`)).toHaveLength(1);
  });

  it('a merchant that is a known organisation (by KvK or BTW-id) is never a lead', async () => {
    const e = corpusEntry(ww, 'mock-retour');
    await orgForCorpusEntry(ww.w, e);
    const who = await loginUser(ww.w);
    const { outcome } = await uploadAndExtract(ww, who, e);
    expect(outcome.lead).toBe('none');
    expect(await lead(`vat:${e.truth.merchant.vatNumber}`)).toHaveLength(0);
  });

  it('a known merchant recognised only by KvK (no BTW-id on the paper receipt) is not a lead either', async () => {
    const e = corpusEntry(ww, 'mock-contant-afronding');
    // organisation with the printed KvK but another BTW-id
    const known = { ...e, truth: { ...e.truth, merchant: { ...e.truth.merchant, vatNumber: 'NL999999999B01' } } };
    await orgForCorpusEntry(ww.w, known);
    const who = await loginUser(ww.w);
    const { outcome } = await uploadAndExtract(ww, who, e);
    expect(outcome.lead).toBe('none');
    expect(await lead(`vat:${e.truth.merchant.vatNumber}`)).toHaveLength(0);
  });

  it('leads:report prints counts only: no merchant names, keys, postcodes or user ids', async () => {
    const out = execFileSync('node', [new URL('../../../scripts/leads-report.ts', import.meta.url).pathname], { env: { ...process.env, PG_DATABASE: ww.w.testDb.name }, encoding: 'utf8' });
    expect(out).toContain('unknown merchants: 2');
    expect(out).toContain('status new: 1 merchants');
    expect(out).toContain('status collecting: 1 merchants');
    for (const secret of ['Frietzak', 'kvk:', 'vat:', '74567123', '2312', ...(await sql<{ id: string }>(ww.w, 'select id from buyer.users')).map((u) => u.id)]) expect(out).not.toContain(secret);
  });

  it('concurrent uploads from distinct users are all counted (the lead row is locked), and the lead turns new exactly at the threshold', async () => {
    const { recordLead } = await import('../src/jobs/extract-upload.ts');
    const ctx = { ...ww.ctx, leadThreshold: 6 };
    const users = await Promise.all(Array.from({ length: 6 }, () => loginUser(ww.w)));
    const results = await Promise.all(users.map((u) => recordLead(ctx, 'kvk:99999999', { name: 'Race BV', postcode: null }, u.userId)));
    expect(results.filter((r) => r === 'new')).not.toHaveLength(0);
    expect(await lead('kvk:99999999')).toEqual([{ status: 'new', distinct_uploaders: 6, name: 'Race BV' }]);
  });
});
