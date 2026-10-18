import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider } from '@lr/billing';
import { adminDbUrl, loadEnv, s3EnvSchema } from '@lr/config';
import { connect, tables, type Db, type DbHandle } from '@lr/db';
import { createOrg } from '@lr/db/provision';
import { createTestDb, type TestDb } from '@lr/db/testing';
import { createObjectStore } from '@lr/storage';
import type { WorkerCtx } from '../src/context.ts';
import { recordedExtractor } from '../src/extractor.ts';
import { billingRenewals } from '../src/jobs/billing-renewals.ts';

let testDb: TestDb;
let adminPool: pg.Pool;
let admin: Db;
let worker: DbHandle;
let ctx: WorkerCtx;

beforeAll(async () => {
  testDb = await createTestDb('billing');
  adminPool = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 2 });
  // `drop database … with (force)` may kill an idle client just before it has said goodbye; that must not crash the run
  adminPool.on('error', () => {});
  admin = drizzle(adminPool) as unknown as Db;
  worker = connect('worker', testDb.env);
  ctx = { db: worker.db, s3: createObjectStore(loadEnv(s3EnvSchema)), extractor: recordedExtractor('unused'), vapid: null, leadThreshold: 20, payments: demoProvider, log: () => {}, now: () => new Date() };
}, 120_000);
afterAll(async () => {
  await worker.close();
  await adminPool.end();
  await testDb.drop();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 17 Oct 2026, 12:00 Amsterdam (summer time); one month later is 17 Nov 12:00 Amsterdam = 11:00 UTC
const T = new Date('2026-10-17T10:00:00Z');
const at = (ms: number) => new Date(T.getTime() + ms);
const run = (now: Date) => billingRenewals({ ...ctx, now: () => now });

let kvk = 40_000_000;
/** An organisation with a subscription written as the owner (the dashboard normally creates it). */
async function org(sub: Partial<typeof tables.subscriptions.$inferInsert> & { failsRenewals?: boolean; mandate?: boolean }): Promise<string> {
  const o = await createOrg(admin, { legalName: `Renewals ${++kvk}`, kvkNumber: String(kvk) });
  const { failsRenewals = false, mandate = true, ...rest } = sub;
  const [m] = mandate
    ? await admin.insert(tables.billingMandates).values({ orgId: o.id, method: 'card', label: failsRenewals ? 'Card •••• 0341' : 'Card •••• 4242', failsRenewals }).returning({ id: tables.billingMandates.id })
    : [];
  await admin.insert(tables.subscriptions).values({
    orgId: o.id,
    plan: 'business',
    interval: 'monthly',
    status: 'active',
    currentPeriodStart: new Date('2026-09-17T10:00:00Z'),
    currentPeriodEnd: T,
    mandateId: m?.id ?? null,
    ...rest,
  });
  return o.id;
}
const sub = async (orgId: string) => (await admin.select().from(tables.subscriptions).where(eq(tables.subscriptions.orgId, orgId)))[0]!;
const invoices = (orgId: string) => admin.select().from(tables.invoices).where(eq(tables.invoices.orgId, orgId)).orderBy(tables.invoices.createdAt);
const audit = async (orgId: string, event: string) => admin.select().from(tables.auditLog).where(and(eq(tables.auditLog.orgId, orgId), eq(tables.auditLog.event, event)));

describe('billing-renewals job (role worker)', () => {
  it('renews an ended period on the mandate: paid invoice, next period; running again (even concurrently) never charges twice', async () => {
    const id = await org({});
    expect((await sub(id)).status).toBe('active');
    await Promise.all([run(T), run(T), run(at(5 * 60_000))]);
    const s = await sub(id);
    expect(s).toMatchObject({ status: 'active', currentPeriodStart: T, currentPeriodEnd: new Date('2026-11-17T11:00:00Z'), pastDueSince: null });
    const inv = await invoices(id);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ status: 'paid', plan: 'business', interval: 'monthly', periodStart: T, netMinor: 4900, vatMinor: 1029, grossMinor: 5929, vatRate: 21, methodLabel: 'Card •••• 4242' });
    expect(inv[0]!.number).toMatch(/^LR-2026-\d{6}$/);
    expect(await audit(id, 'billing_renewed')).toHaveLength(1);
    // a later run in the same period does nothing
    await run(at(10 * DAY));
    expect(await invoices(id)).toHaveLength(1);
  });

  it('a scheduled plan change is applied at the renewal', async () => {
    const id = await org({ pendingPlan: 'starter', pendingInterval: 'annual' });
    await run(T);
    expect(await sub(id)).toMatchObject({ status: 'active', plan: 'starter', interval: 'annual', pendingPlan: null, pendingInterval: null, currentPeriodEnd: new Date('2027-10-17T10:00:00Z') });
    expect((await invoices(id))[0]).toMatchObject({ plan: 'starter', interval: 'annual', netMinor: 19000, grossMinor: 22990 });
  });

  it('a failed renewal makes it past_due with a failed invoice; it is retried once per 24 h, not sooner', async () => {
    const id = await org({ failsRenewals: true });
    await run(T);
    expect(await sub(id)).toMatchObject({ status: 'past_due', pastDueSince: T, lastChargeAttemptAt: T, currentPeriodEnd: T });
    expect((await invoices(id)).map((i) => i.status)).toEqual(['failed']);
    expect(await audit(id, 'billing_renewal_failed')).toHaveLength(1);

    await run(at(HOUR));
    await run(at(23 * HOUR));
    expect(await invoices(id)).toHaveLength(1);

    await run(at(DAY));
    expect(await sub(id)).toMatchObject({ status: 'past_due', pastDueSince: T, lastChargeAttemptAt: at(DAY) });
    expect((await invoices(id)).map((i) => i.status)).toEqual(['failed', 'failed']);
  });

  it('a retry that succeeds (new payment details on the mandate) restores active, from the original period end', async () => {
    const id = await org({ failsRenewals: true });
    await run(T);
    await admin.update(tables.billingMandates).set({ failsRenewals: false }).where(eq(tables.billingMandates.orgId, id));
    await run(at(DAY));
    expect(await sub(id)).toMatchObject({ status: 'active', pastDueSince: null, currentPeriodStart: T, currentPeriodEnd: new Date('2026-11-17T11:00:00Z') });
    expect((await invoices(id)).map((i) => i.status)).toEqual(['failed', 'paid']);
  });

  it('after 7 days in past_due the subscription is canceled', async () => {
    const id = await org({ failsRenewals: true });
    for (let d = 0; d < 7; d++) await run(at(d * DAY));
    expect((await sub(id)).status).toBe('past_due');
    expect(await invoices(id)).toHaveLength(7);
    await run(at(7 * DAY));
    expect(await sub(id)).toMatchObject({ status: 'canceled', pastDueSince: null });
    expect(await invoices(id)).toHaveLength(7);
    expect((await audit(id, 'billing_ended'))[0]?.detail).toMatchObject({ reason: 'unpaid' });
    await run(at(30 * DAY));
    expect(await invoices(id)).toHaveLength(7);
  });

  it('cancel at period end: ends at the period end, no charge', async () => {
    const id = await org({ cancelAtPeriodEnd: true });
    await run(at(-60_000));
    expect((await sub(id)).status).toBe('active');
    await run(T);
    expect(await sub(id)).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: false });
    expect(await invoices(id)).toEqual([]);
    expect((await audit(id, 'billing_ended'))[0]?.detail).toMatchObject({ reason: 'canceled' });
  });

  it('a trial that ends without payment is canceled', async () => {
    const id = await org({ status: 'trialing', mandate: false, trialEndsAt: T, currentPeriodStart: null, currentPeriodEnd: null });
    await run(at(-60_000));
    expect((await sub(id)).status).toBe('trialing');
    await run(T);
    expect((await sub(id)).status).toBe('canceled');
    expect((await audit(id, 'billing_ended'))[0]?.detail).toMatchObject({ reason: 'trial_ended' });
    expect(await invoices(id)).toEqual([]);
  });

  it('no mandate: the renewal fails (past_due) instead of extending the period for free', async () => {
    const id = await org({ mandate: false });
    await run(T);
    expect((await sub(id)).status).toBe('past_due');
    expect((await invoices(id))[0]).toMatchObject({ status: 'failed', methodLabel: null });
  });
});
