import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoProvider, priceFor, TEST_CARDS } from '@lr/billing';
import { generateKeyPair } from '@lr/crypto';
import { connect, tables, type DbHandle } from '@lr/db';
import { createLocation as provisionLocation, createOrg } from '@lr/db/provision';
import {
  billingNotice,
  cancelSubscription,
  completeDemoCheckout,
  createLocation,
  createTerminal,
  ForbiddenError,
  getBilling,
  getCheckout,
  invoicePdf,
  listInvoices,
  resumeSubscription,
  revokeTerminal,
  runRenewals,
  scheduleChange,
  simulateRenewal,
  startCheckout,
  undoChange,
  type Actor,
  type BillingDeps,
} from '../src/index.ts';
import { fixture, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
let worker: DbHandle;
let clock = new Date('2026-10-17T10:00:00Z');
const deps: BillingDeps = { provider: demoProvider, now: () => clock };
const DAY = 86_400_000;

beforeAll(async () => {
  f = await fixture('dc_billing');
  worker = connect('worker', f.testDb.env);
});
afterAll(async () => {
  await worker.close();
  await f.close();
});

let kvkSeq = 30_000_000;
/** A fresh organisation (one location) with an owner, so each scenario starts from its own trial. */
async function freshOwner(): Promise<Actor> {
  const kvk = String(++kvkSeq);
  const org = await createOrg(f.admin, { legalName: `Billing ${kvk} B.V.`, kvkNumber: kvk });
  const loc = await provisionLocation(f.admin, org.id, 'Hoofdvestiging');
  f.orgs.push({ id: org.id, locationId: loc.id, kvk });
  return (await userWithRole(f, f.orgs.length - 1, 'owner')).actor;
}

const card = (number: string) => ({ method: 'card', number, expiry: '12/30', cvc: '123' });
async function buy(actor: Actor, plan: 'starter' | 'business', interval: 'monthly' | 'annual', method: unknown = card(TEST_CARDS.success)) {
  const { id } = await startCheckout(f.dash.db, actor, { plan, interval }, deps);
  return { id, result: await completeDemoCheckout(f.dash.db, actor, id, method, deps) };
}
const subOf = async (orgId: string) => (await f.admin.select().from(tables.subscriptions).where(eq(tables.subscriptions.orgId, orgId)))[0]!;
const auditEvents = async (orgId: string) => (await f.admin.select({ event: tables.auditLog.event }).from(tables.auditLog).where(eq(tables.auditLog.orgId, orgId))).map((r) => r.event);

describe('trial and checkout', () => {
  it('starts lazily as a 14-day Business trial', async () => {
    const owner = await freshOwner();
    expect(await f.admin.select().from(tables.subscriptions).where(eq(tables.subscriptions.orgId, owner.orgId))).toHaveLength(0);
    const b = await getBilling(f.dash.db, owner, deps);
    expect(b).toMatchObject({ status: 'trialing', effectivePlan: 'business', trialDaysLeft: 14, method: null, next: null, usage: { locations: 1, activeTerminals: 0 } });
    expect(b.trialEndsAt?.toISOString()).toBe(new Date(clock.getTime() + 14 * DAY).toISOString());
    // a second read does not restart it
    clock = new Date(clock.getTime() + DAY);
    expect((await getBilling(f.dash.db, owner, deps)).trialDaysLeft).toBe(13);
    expect(await billingNotice(f.dash.db, owner, deps)).toBeNull();
    clock = new Date(clock.getTime() + 10 * DAY);
    expect(await billingNotice(f.dash.db, owner, deps)).toEqual({ kind: 'trial_ending', daysLeft: 3 });
    clock = new Date('2026-10-17T10:00:00Z');
  });

  it('pay with card 4242: active, period from now, mandate label only, paid invoice, audited; no card data stored', async () => {
    const owner = await freshOwner();
    const { id, result } = await buy(owner, 'business', 'annual');
    expect(result).toMatchObject({ status: 'paid' });
    const b = await getBilling(f.dash.db, owner, deps);
    expect(b).toMatchObject({ status: 'active', plan: 'business', interval: 'annual', method: 'Card •••• 4242', cancelAtPeriodEnd: false, pendingPlan: null });
    expect(b.currentPeriodStart?.toISOString()).toBe(clock.toISOString());
    expect(b.currentPeriodEnd?.toISOString()).toBe('2027-10-17T10:00:00.000Z');
    expect(b.next).toMatchObject({ plan: 'business', interval: 'annual', ...priceFor('business', 'annual') });

    const invoices = await listInvoices(f.dash.db, owner);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: 'paid', plan: 'business', interval: 'annual', net: 49000, vat: 10290, gross: 59290, vatRate: 21, methodLabel: 'Card •••• 4242' });
    expect(invoices[0]!.number).toMatch(/^LR-2026-\d{6}$/);
    const checkout = await getCheckout(f.dash.db, owner, id, deps);
    expect(checkout.status).toBe('paid');

    const [mandate] = await f.admin.select().from(tables.billingMandates).where(eq(tables.billingMandates.orgId, owner.orgId));
    expect(mandate).toMatchObject({ method: 'card', label: 'Card •••• 4242', failsRenewals: false, revokedAt: null });
    expect(await auditEvents(owner.orgId)).toEqual(expect.arrayContaining(['billing_checkout_started', 'billing_paid']));

    const everything = JSON.stringify([
      await f.admin.select().from(tables.billingMandates),
      await f.admin.select().from(tables.paymentSessions),
      await f.admin.select().from(tables.invoices),
      await f.admin.select().from(tables.subscriptions),
      await f.admin.select().from(tables.auditLog),
    ]);
    expect(everything).not.toContain('4242424242424242');
    expect(everything).not.toContain('4242 4242');
    expect(everything).not.toMatch(/"cvc"|12\/30/);

    const pdf = await invoicePdf(f.dash.db, owner, invoices[0]!.id);
    expect(pdf.number).toBe(invoices[0]!.number);
    expect(Buffer.from(pdf.pdf.subarray(0, 5)).toString()).toBe('%PDF-');

    // the subscription is active now: a second checkout is refused (changes are scheduled instead)
    await expect(startCheckout(f.dash.db, owner, { plan: 'starter', interval: 'monthly' }, deps)).rejects.toMatchObject({ code: 'conflict' });
    // and the paid checkout cannot be paid again
    await expect(completeDemoCheckout(f.dash.db, owner, id, card(TEST_CARDS.success), deps)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('declined card 0002 or iDEAL "Demo: weigeren": checkout failed, subscription unchanged, no invoice', async () => {
    const owner = await freshOwner();
    await getBilling(f.dash.db, owner, deps);
    const before = await subOf(owner.orgId);
    const declined = await buy(owner, 'starter', 'monthly', card('4000 0000 0000 0002'));
    expect(declined.result).toEqual({ status: 'failed', reason: 'card_declined' });
    const ideal = await buy(owner, 'starter', 'monthly', { method: 'ideal', bank: 'Demo: weigeren' });
    expect(ideal.result).toEqual({ status: 'failed', reason: 'ideal_declined' });
    expect(await subOf(owner.orgId)).toEqual(before);
    expect(await listInvoices(f.dash.db, owner)).toEqual([]);
    expect((await getCheckout(f.dash.db, owner, declined.id, deps)).status).toBe('failed');
    expect(await auditEvents(owner.orgId)).toContain('billing_payment_failed');
    expect(await f.admin.select().from(tables.billingMandates).where(eq(tables.billingMandates.orgId, owner.orgId))).toEqual([]);
  });

  it('validates the payment details and refuses an expired checkout', async () => {
    const owner = await freshOwner();
    const { id } = await startCheckout(f.dash.db, owner, { plan: 'business', interval: 'monthly' }, deps);
    await expect(completeDemoCheckout(f.dash.db, owner, id, { method: 'card', number: '4242 4242 4242 4241', expiry: '12/30', cvc: '123' }, deps)).rejects.toMatchObject({ code: 'validation' });
    await expect(completeDemoCheckout(f.dash.db, owner, id, { method: 'card', number: TEST_CARDS.success, expiry: '01/20', cvc: '123' }, deps)).rejects.toMatchObject({ code: 'validation' });
    await expect(completeDemoCheckout(f.dash.db, owner, id, { method: 'ideal', bank: 'Nope Bank' }, deps)).rejects.toMatchObject({ code: 'validation' });
    await expect(startCheckout(f.dash.db, owner, { plan: 'gold', interval: 'monthly' }, deps)).rejects.toMatchObject({ code: 'validation' });
    clock = new Date(clock.getTime() + 31 * 60_000);
    try {
      expect((await getCheckout(f.dash.db, owner, id, deps)).status).toBe('expired');
      await expect(completeDemoCheckout(f.dash.db, owner, id, card(TEST_CARDS.success), deps)).rejects.toMatchObject({ code: 'conflict', message: 'checkout expired' });
    } finally {
      clock = new Date('2026-10-17T10:00:00Z');
    }
    await expect(getCheckout(f.dash.db, owner, 'not-a-uuid', deps)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('changes, cancel and resume (active)', () => {
  it('a plan change is scheduled for the next renewal, can be undone, and is applied when the period renews', async () => {
    const owner = await freshOwner();
    await buy(owner, 'business', 'monthly');
    await scheduleChange(f.dash.db, owner, { plan: 'starter', interval: 'annual' }, deps);
    let b = await getBilling(f.dash.db, owner, deps);
    expect(b).toMatchObject({ plan: 'business', interval: 'monthly', pendingPlan: 'starter', pendingInterval: 'annual', next: { plan: 'starter', interval: 'annual', gross: 22990 } });
    await undoChange(f.dash.db, owner, deps);
    expect((await getBilling(f.dash.db, owner, deps)).pendingPlan).toBeNull();
    await expect(undoChange(f.dash.db, owner, deps)).rejects.toMatchObject({ code: 'conflict' });
    await expect(scheduleChange(f.dash.db, owner, { plan: 'business', interval: 'monthly' }, deps)).rejects.toMatchObject({ code: 'validation' });
    await scheduleChange(f.dash.db, owner, { plan: 'starter', interval: 'annual' }, deps);

    // renewal on 17 Nov, 12:00 Amsterdam (11:00 UTC in winter time): change applied, a year's period, paid invoice
    const renewalAt = new Date('2026-11-17T11:00:00Z');
    expect((await runRenewals(worker.db, renewalAt, demoProvider)).renewed).toBeGreaterThanOrEqual(1);
    b = await getBilling(f.dash.db, owner, deps);
    expect(b).toMatchObject({ status: 'active', plan: 'starter', interval: 'annual', pendingPlan: null, pendingInterval: null });
    expect(b.currentPeriodStart?.toISOString()).toBe('2026-11-17T11:00:00.000Z');
    expect(b.currentPeriodEnd?.toISOString()).toBe('2027-11-17T11:00:00.000Z');
    const invoices = await listInvoices(f.dash.db, owner);
    expect(invoices.map((i) => [i.plan, i.interval, i.status, i.gross])).toEqual([
      ['starter', 'annual', 'paid', 22990],
      ['business', 'monthly', 'paid', 5929],
    ]);
    expect(await auditEvents(owner.orgId)).toEqual(expect.arrayContaining(['billing_change_scheduled', 'billing_change_undone', 'billing_renewed']));
  });

  it('cancel at period end, resume, cancel again: the subscription ends at the period end', async () => {
    const owner = await freshOwner();
    await buy(owner, 'starter', 'monthly');
    await cancelSubscription(f.dash.db, owner, deps);
    expect(await getBilling(f.dash.db, owner, deps)).toMatchObject({ status: 'active', cancelAtPeriodEnd: true, next: null });
    await expect(scheduleChange(f.dash.db, owner, { plan: 'business', interval: 'monthly' }, deps)).rejects.toMatchObject({ code: 'conflict' });
    await resumeSubscription(f.dash.db, owner, deps);
    expect((await getBilling(f.dash.db, owner, deps)).cancelAtPeriodEnd).toBe(false);
    await cancelSubscription(f.dash.db, owner, deps);
    expect((await runRenewals(worker.db, new Date('2026-11-17T11:00:00Z'), demoProvider)).ended).toBeGreaterThanOrEqual(1);
    expect((await getBilling(f.dash.db, owner, deps)).status).toBe('canceled');
    expect(await listInvoices(f.dash.db, owner)).toHaveLength(1);
    expect(await auditEvents(owner.orgId)).toEqual(expect.arrayContaining(['billing_canceled', 'billing_resumed', 'billing_ended']));
    await expect(resumeSubscription(f.dash.db, owner, deps)).rejects.toMatchObject({ code: 'conflict' });
    // a canceled organisation can buy again (a month later)
    clock = new Date('2026-11-18T10:00:00Z');
    try {
      expect((await buy(owner, 'business', 'monthly')).result.status).toBe('paid');
    } finally {
      clock = new Date('2026-10-17T10:00:00Z');
    }
  });

  it('demo "simulate renewal": card 0341 pays once, then the renewal fails and the banner says payment failed', async () => {
    const owner = await freshOwner();
    await expect(simulateRenewal(f.dash.db, owner, deps)).rejects.toMatchObject({ code: 'conflict' });
    await buy(owner, 'business', 'monthly', card(TEST_CARDS.renewalsFail));
    expect(await simulateRenewal(f.dash.db, owner, deps)).toBe('renewal_failed');
    expect(await getBilling(f.dash.db, owner, deps)).toMatchObject({ status: 'past_due', method: 'Card •••• 0341' });
    expect(await billingNotice(f.dash.db, owner, deps)).toEqual({ kind: 'past_due' });
    expect((await listInvoices(f.dash.db, owner)).map((i) => i.status)).toEqual(['failed', 'paid']);
    // past_due: pay again with a working card (new mandate replaces the old one); the clock moves on between clicks
    clock = new Date(clock.getTime() + 60_000);
    expect((await buy(owner, 'business', 'monthly')).result.status).toBe('paid');
    expect(await getBilling(f.dash.db, owner, deps)).toMatchObject({ status: 'active', method: 'Card •••• 4242' });
    clock = new Date(clock.getTime() + 60_000);
    try {
      expect(await simulateRenewal(f.dash.db, owner, deps)).toBe('renewed');
      expect((await listInvoices(f.dash.db, owner)).map((i) => i.status)).toEqual(['paid', 'paid', 'failed', 'paid']);
    } finally {
      clock = new Date('2026-10-17T10:00:00Z');
    }
  });
});

describe('permissions and isolation', () => {
  it('accountant reads billing and invoices but cannot change anything; manager has no billing access', async () => {
    const owner = await freshOwner();
    await buy(owner, 'business', 'monthly');
    const idx = f.orgs.findIndex((o) => o.id === owner.orgId);
    const accountant = (await userWithRole(f, idx, 'accountant')).actor;
    const manager = (await userWithRole(f, idx, 'manager')).actor;
    const [inv] = await listInvoices(f.dash.db, accountant);
    expect((await getBilling(f.dash.db, accountant, deps)).status).toBe('active');
    expect((await invoicePdf(f.dash.db, accountant, inv!.id)).pdf.length).toBeGreaterThan(500);
    for (const fn of [
      () => startCheckout(f.dash.db, accountant, { plan: 'starter', interval: 'monthly' }, deps),
      () => scheduleChange(f.dash.db, accountant, { plan: 'starter', interval: 'monthly' }, deps),
      () => undoChange(f.dash.db, accountant, deps),
      () => cancelSubscription(f.dash.db, accountant, deps),
      () => resumeSubscription(f.dash.db, accountant, deps),
      () => simulateRenewal(f.dash.db, accountant, deps),
      () => getCheckout(f.dash.db, accountant, inv!.id, deps),
      () => getBilling(f.dash.db, manager, deps),
      () => listInvoices(f.dash.db, manager),
      () => invoicePdf(f.dash.db, manager, inv!.id),
      () => startCheckout(f.dash.db, manager, { plan: 'starter', interval: 'monthly' }, deps),
    ]) {
      await expect(fn()).rejects.toBeInstanceOf(ForbiddenError);
    }
    // the banner state is visible to every role
    expect(await billingNotice(f.dash.db, manager, deps)).toBeNull();
  });

  it('organisation A cannot see or pay organisation B’s checkout, invoices or PDFs', async () => {
    const a = await freshOwner();
    const b = await freshOwner();
    const bought = await buy(b, 'starter', 'monthly');
    const [bInvoice] = await listInvoices(f.dash.db, b);
    const pending = await startCheckout(f.dash.db, b, { plan: 'business', interval: 'monthly' }, deps).catch(() => null);
    expect(pending).toBeNull(); // b is active
    await expect(getCheckout(f.dash.db, a, bought.id, deps)).rejects.toMatchObject({ code: 'not_found' });
    await expect(completeDemoCheckout(f.dash.db, a, bought.id, card(TEST_CARDS.success), deps)).rejects.toMatchObject({ code: 'not_found' });
    await expect(invoicePdf(f.dash.db, a, bInvoice!.id)).rejects.toMatchObject({ code: 'not_found' });
    expect(await listInvoices(f.dash.db, a)).toEqual([]);
    expect((await getBilling(f.dash.db, a, deps)).status).toBe('trialing');
  });
});

describe('enforcement in the dashboard', () => {
  const key = () => generateKeyPair().publicKey;

  it('starter: a 2nd location and a 3rd active terminal are refused with plan_limit; revoking frees a slot', async () => {
    const owner = await freshOwner();
    const loc = f.orgs.find((o) => o.id === owner.orgId)!.locationId;
    await buy(owner, 'starter', 'monthly');
    await expect(createLocation(f.dash.db, owner, { name: 'Tweede' })).rejects.toMatchObject({ code: 'plan_limit' });
    const t1 = await createTerminal(f.dash.db, owner, { locationId: loc, label: 'Kassa 1', publicKey: key() });
    await createTerminal(f.dash.db, owner, { locationId: loc, label: 'Kassa 2', publicKey: key() });
    await expect(createTerminal(f.dash.db, owner, { locationId: loc, label: 'Kassa 3', publicKey: key() })).rejects.toMatchObject({ code: 'plan_limit' });
    expect((await getBilling(f.dash.db, owner, deps)).usage).toEqual({ locations: 1, activeTerminals: 2 });
    await revokeTerminal(f.dash.db, owner, t1.terminalId);
    await createTerminal(f.dash.db, owner, { locationId: loc, label: 'Kassa 3', publicKey: key() });
  });

  it('trial and business: no limits', async () => {
    const owner = await freshOwner();
    for (const name of ['Twee', 'Drie']) await createLocation(f.dash.db, owner, { name });
    const loc = f.orgs.find((o) => o.id === owner.orgId)!.locationId;
    for (const label of ['A', 'B', 'C']) await createTerminal(f.dash.db, owner, { locationId: loc, label, publicKey: key() });
  });

  it('canceled (trial ended without payment): new terminals and locations are refused with plan_inactive; reading still works', async () => {
    const owner = await freshOwner();
    await getBilling(f.dash.db, owner, deps);
    expect((await runRenewals(worker.db, new Date(clock.getTime() + 15 * DAY), demoProvider)).ended).toBeGreaterThanOrEqual(1);
    expect(await billingNotice(f.dash.db, owner, deps)).toEqual({ kind: 'inactive' });
    const loc = f.orgs.find((o) => o.id === owner.orgId)!.locationId;
    await expect(createTerminal(f.dash.db, owner, { locationId: loc, label: 'x', publicKey: key() })).rejects.toMatchObject({ code: 'plan_inactive' });
    await expect(createLocation(f.dash.db, owner, { name: 'x' })).rejects.toMatchObject({ code: 'plan_inactive' });
    expect(await getBilling(f.dash.db, owner, deps)).toMatchObject({ status: 'canceled', effectivePlan: null, limits: null });
  });
});
