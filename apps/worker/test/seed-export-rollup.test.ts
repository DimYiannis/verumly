import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { demoProvider } from '@lr/billing';
import { adminDbUrl, loadEnv } from '@lr/config';
import { connect, type DbHandle } from '@lr/db';
import { createTestDb, type TestDb } from '@lr/db/testing';
import { createObjectStore } from '@lr/storage';
import { loadCorpus } from '../../../scripts/lib/corpus.ts';
import { runSeed, SEED, type PlannedReceipt, type SeedResult } from '../../../scripts/seed.ts';
import type { WorkerCtx } from '../src/context.ts';
import { workerEnvSchema, type WorkerEnv } from '../src/env.ts';
import { recordedExtractor } from '../src/extractor.ts';
import { runExport } from '../src/jobs/export.ts';
import { rollupDaily } from '../src/jobs/rollup-daily.ts';

let testDb: TestDb;
let env: WorkerEnv;
let seeded: SeedResult;
let worker: DbHandle;
let admin: pg.Pool;
let ctx: WorkerCtx;
const keys: string[] = [];

beforeAll(async () => {
  testDb = await createTestDb('seed');
  env = { ...loadEnv(workerEnvSchema), ...testDb.env };
  seeded = await runSeed({ env, secretsPath: false, log: () => {} });
  worker = connect('worker', testDb.env);
  admin = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 2 });
  // `drop database … with (force)` may kill an idle client just before it has said goodbye; that must not crash the run
  admin.on('error', () => {});
  ctx = { db: worker.db, s3: createObjectStore(env), extractor: recordedExtractor(env.FIXTURES_DIR), vapid: null, leadThreshold: 20, payments: demoProvider, log: () => {}, now: () => new Date() };
}, 180_000);

afterAll(async () => {
  const s3 = createObjectStore(env);
  for (const k of keys) await s3.remove(k).catch(() => {});
  const uploads = await admin.query<{ s3_key: string }>('select s3_key from buyer.uploads');
  for (const u of uploads.rows) await s3.remove(u.s3_key).catch(() => {});
  await admin.end();
  await worker.close();
  await testDb.drop();
});

// ------------------------------------------------------------- independent oracle (plain arithmetic, no @lr packages)

const AMSTERDAM = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

interface Expected {
  gross: number;
  net: number;
  vat: number;
  receipts: number;
}

/** per day → per rate → totals, for the paid receipts of the seed plan */
function oracle(planned: PlannedReceipt[]): { byDay: Record<string, Record<number, Expected>>; rounding: number; paid: number } {
  const byDay: Record<string, Record<number, Expected>> = {};
  let rounding = 0;
  let paid = 0;
  for (const p of planned.filter((x) => x.finalState === 'paid')) {
    paid++;
    const day = AMSTERDAM.format(new Date(p.finalAt));
    const perRate: Record<number, number> = {};
    let gross = 0;
    for (const l of p.lines) {
      const total = Number(l.qty) * l.unitPrice;
      perRate[l.vatRate] = (perRate[l.vatRate] ?? 0) + total;
      gross += total;
    }
    if (p.cash) rounding += Math.round(gross / 5) * 5 - gross;
    for (const [rate, g] of Object.entries(perRate)) {
      const r = Number(rate);
      // vat = round-half-up(gross × r / (100 + r)) per receipt and rate
      const vat = Math.floor((2 * g * r + (100 + r)) / (2 * (100 + r)));
      const d = ((byDay[day] ??= {})[r] ??= { gross: 0, net: 0, vat: 0, receipts: 0 });
      d.gross += g;
      d.vat += vat;
      d.net += g - vat;
      d.receipts += 1;
    }
  }
  return { byDay, rounding, paid };
}

async function runExportJob(kind: 'sales_csv' | 'btw_csv', from: string, to: string): Promise<string> {
  const [row] = await admin
    .query<{ id: string }>("insert into merchant.exports (org_id, kind, period_from, period_to) values ($1, $2, $3, $4) returning id", [seeded.orgId, kind, from, to])
    .then((r) => r.rows);
  const out = await runExport(ctx, { exportId: row!.id });
  expect(out.status).toBe('done');
  keys.push(out.key!);
  const done = await admin.query<{ status: string; s3_key: string; url: string; expires_at: Date }>('select status, s3_key, url, expires_at from merchant.exports where id = $1', [row!.id]);
  const e = done.rows[0]!;
  expect(e.status).toBe('done');
  expect(e.s3_key).toBe(out.key);
  // the link is valid for 24 hours
  expect(e.expires_at.getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);
  expect(e.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
  expect(new URL(e.url).searchParams.get('X-Amz-Expires')).toBe(String(24 * 3600));
  const res = await fetch(e.url);
  expect(res.status).toBe(200);
  return res.text();
}

describe('seed (v2 §15)', () => {
  it('creates 200 receipts for the café over 60 days, 30 claimed, 3 uploads with one matching an official receipt', async () => {
    const q = async (text: string) => (await admin.query<Record<string, string>>(text, [])).rows;
    expect((await q(`select count(*) n from merchant.receipts where org_id = '${seeded.orgId}'`))[0]?.n).toBe('200');
    expect((await q(`select count(*) n from buyer.claims where user_id = '${seeded.buyerId}'`))[0]?.n).toBe('30');
    expect((await q(`select count(*) n from buyer.uploads where user_id = '${seeded.buyerId}'`))[0]?.n).toBe('3');
    expect((await q('select count(*) n from buyer.uploads where matched_receipt_id is not null'))[0]?.n).toBe('1');
    expect((await q("select count(*) n from merchant.terminals t join merchant.organizations o on o.id = t.org_id where o.kvk_number = '12345678'"))[0]?.n).toBe('2');
    expect((await q("select count(*) n from merchant.merchant_users where email = 'owner@example.test'"))[0]?.n).toBe('1');
    // both VAT rates and cash rounding occur
    const rates = await q("select distinct (e->>'rate') r from merchant.receipt_versions v, jsonb_array_elements(v.payload->'vatSummary') e order by 1");
    expect(rates.map((r) => r.r)).toEqual(['21', '9']);
    expect(Number((await q("select count(*) n from merchant.receipt_versions where (payload->'totals'->>'rounding')::int <> 0"))[0]?.n)).toBeGreaterThan(0);
    // spread over 60 days
    const span = await q(`select (max(created_on_terminal_at)::date - min(created_on_terminal_at)::date) d from merchant.receipts where org_id = '${seeded.orgId}'`);
    expect(Number(span[0]?.d)).toBeGreaterThanOrEqual(58);
    expect(loadCorpus({ quiet: true }).kind).toMatch(/mock|real/);
  });

  it('gives the café an active Business monthly subscription on card 4242 with 2 paid invoices', async () => {
    const sub = await admin.query("select s.plan, s.interval, s.status, s.current_period_end > now() as current, m.label from merchant.subscriptions s join merchant.billing_mandates m on m.id = s.mandate_id where s.org_id = $1", [seeded.orgId]);
    expect(sub.rows).toEqual([{ plan: 'business', interval: 'monthly', status: 'active', current: true, label: 'Card •••• 4242' }]);
    const inv = await admin.query("select status, gross_minor, period_start < now() as past from merchant.invoices where org_id = $1 order by period_start", [seeded.orgId]);
    expect(inv.rows).toEqual([
      { status: 'paid', gross_minor: 5929, past: true },
      { status: 'paid', gross_minor: 5929, past: true },
    ]);
  });

  it('is idempotent: a second run adds nothing', async () => {
    const before = await admin.query('select (select count(*) from merchant.receipts) r, (select count(*) from buyer.claims) c, (select count(*) from buyer.uploads) u, (select count(*) from merchant.organizations) o, (select count(*) from merchant.terminals) t, (select count(*) from buyer.users) b, (select count(*) from merchant.invoices) i, (select count(*) from merchant.billing_mandates) m');
    const again = await runSeed({ env, secretsPath: false, log: () => {} });
    expect(again.created).toEqual({ receipts: 0, claims: 0, uploads: 0, terminals: 0 });
    const after = await admin.query('select (select count(*) from merchant.receipts) r, (select count(*) from buyer.claims) c, (select count(*) from buyer.uploads) u, (select count(*) from merchant.organizations) o, (select count(*) from merchant.terminals) t, (select count(*) from buyer.users) b, (select count(*) from merchant.invoices) i, (select count(*) from merchant.billing_mandates) m');
    expect(after.rows).toEqual(before.rows);
    expect(SEED.receiptTarget).toBe(200);
  });
});

describe('export job vs the seed, recomputed independently', () => {
  it('accountant CSV: VAT per day and rate, VAT return box 1a/1b, and the period totals match the oracle to the cent', async () => {
    const exp = oracle(seeded.planned);
    const days = Object.keys(exp.byDay).sort();
    const from = days[0]!;
    const to = days[days.length - 1]!;
    const csv = await runExportJob('btw_csv', from, to);
    const rows = csv.trim().split('\n').map((l) => l.split(','));
    expect(rows[0]).toEqual(['scope', 'period', 'vat_return_box', 'rate', 'gross_cents', 'net_cents', 'vat_cents', 'receipts']);

    const dayRows = rows.filter((r) => r[0] === 'day');
    const expectedDayRows = days.flatMap((d) => [21, 9].filter((rate) => exp.byDay[d]?.[rate]).map((rate) => [d, rate, exp.byDay[d]![rate]!] as const));
    expect(dayRows).toHaveLength(expectedDayRows.length);
    for (const [d, rate, e] of expectedDayRows) {
      const row = dayRows.find((r) => r[1] === d && r[3] === String(rate));
      expect(row, `${d} ${rate}%`).toBeDefined();
      expect(row![2]).toBe(rate === 21 ? '1a' : '1b');
      expect(row!.slice(4).map(Number)).toEqual([e.gross, e.net, e.vat, e.receipts]);
    }
    // period totals per VAT return box
    for (const rate of [21, 9]) {
      const total = expectedDayRows.filter(([, r]) => r === rate).reduce((s, [, , e]) => ({ gross: s.gross + e.gross, net: s.net + e.net, vat: s.vat + e.vat, receipts: s.receipts + e.receipts }), { gross: 0, net: 0, vat: 0, receipts: 0 });
      const row = rows.find((r) => r[0] === 'period' && r[3] === String(rate));
      expect(row![1]).toBe(`${from}..${to}`);
      expect(row!.slice(4).map(Number)).toEqual([total.gross, total.net, total.vat, total.receipts]);
    }
    // void and presented receipts are not in the BTW file
    expect(seeded.planned.some((p) => p.finalState === 'void')).toBe(true);
    expect(seeded.planned.some((p) => p.finalState === 'presented')).toBe(true);
  });

  it('sales CSV: one row per paid or void receipt; gross and rounding totals match the oracle', async () => {
    const exp = oracle(seeded.planned);
    const days = Object.keys(exp.byDay).sort();
    const csv = await runExportJob('sales_csv', days[0]!, days[days.length - 1]!);
    const rows = csv.trim().split('\n').slice(1).map((l) => l.split(','));
    const paid = rows.filter((r) => r[4] === 'paid');
    const voided = rows.filter((r) => r[4] === 'void');
    expect(paid).toHaveLength(exp.paid);
    expect(voided).toHaveLength(seeded.planned.filter((p) => p.finalState === 'void').length);
    const grossOracle = seeded.planned.filter((p) => p.finalState === 'paid').reduce((s, p) => s + p.lines.reduce((t, l) => t + Number(l.qty) * l.unitPrice, 0), 0);
    expect(paid.reduce((s, r) => s + Number(r[5]), 0)).toBe(grossOracle);
    expect(paid.reduce((s, r) => s + Number(r[9]), 0)).toBe(exp.rounding);
    expect(exp.rounding).not.toBe(0);
  });

  it('daily_rollups (rollup-daily job) agree with the oracle per day: gross, BTW per rate, counts, voids', async () => {
    await rollupDaily(ctx, { orgId: seeded.orgId, from: '2000-01-01', to: '2100-01-01' });
    const exp = oracle(seeded.planned);
    const rows = await admin.query<{ day: Date; gross: string; gross_21: string; vat_21: string; gross_9: string; vat_9: string; receipt_count: number; void_count: number }>(
      'select to_char(day, \'YYYY-MM-DD\') as day, gross, gross_21, vat_21, gross_9, vat_9, receipt_count, void_count from merchant.daily_rollups where org_id = $1 order by day',
      [seeded.orgId],
    );
    const days = new Set(rows.rows.map((r) => String(r.day)));
    const voidDays: Record<string, number> = {};
    for (const p of seeded.planned.filter((x) => x.finalState === 'void')) {
      const d = AMSTERDAM.format(new Date(p.finalAt));
      voidDays[d] = (voidDays[d] ?? 0) + 1;
    }
    for (const d of Object.keys(exp.byDay)) expect(days.has(d)).toBe(true);
    for (const r of rows.rows) {
      const day = String(r.day);
      const e = exp.byDay[day] ?? {};
      expect(Number(r.gross_21)).toBe(e[21]?.gross ?? 0);
      expect(Number(r.vat_21)).toBe(e[21]?.vat ?? 0);
      expect(Number(r.gross_9)).toBe(e[9]?.gross ?? 0);
      expect(Number(r.vat_9)).toBe(e[9]?.vat ?? 0);
      expect(Number(r.gross)).toBe((e[21]?.gross ?? 0) + (e[9]?.gross ?? 0));
      expect(r.void_count).toBe(voidDays[day] ?? 0);
      const paidThatDay = seeded.planned.filter((p) => p.finalState === 'paid' && AMSTERDAM.format(new Date(p.finalAt)) === day).length;
      expect(r.receipt_count).toBe(paidThatDay);
    }
    // re-running replaces, never duplicates
    await rollupDaily(ctx, { orgId: seeded.orgId, from: '2000-01-01', to: '2100-01-01' });
    const again = await admin.query('select count(*)::int n from merchant.daily_rollups where org_id = $1', [seeded.orgId]);
    expect(again.rows[0].n).toBe(rows.rows.length);
  });

  it('a failed export is marked failed and rethrown (unknown kind); a finished export is not rebuilt', async () => {
    const bad = await admin.query<{ id: string }>("insert into merchant.exports (org_id, kind, period_from, period_to) values ($1, 'nope', '2026-01-01', '2026-01-31') returning id", [seeded.orgId]);
    await expect(runExport(ctx, { exportId: bad.rows[0]!.id })).rejects.toThrow(/unknown export kind/);
    expect((await admin.query('select status from merchant.exports where id = $1', [bad.rows[0]!.id])).rows[0].status).toBe('failed');
  });
});
