import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  addInterval,
  amsterdamYear,
  checkLimit,
  CHECKOUT_TTL_MINUTES,
  daysLeft,
  demoProvider,
  effectivePlan,
  GRACE_DAYS,
  INTERVALS,
  methodProblems,
  planLimits,
  PLANS,
  priceFor,
  RETRY_AFTER_HOURS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  TRIAL_WARNING_DAYS,
  VAT_RATE,
  type Interval,
  type Mandate,
  type PaymentMethod,
  type PaymentProvider,
  type Plan,
  type PlanLimits,
  type SubscriptionStatus,
} from '@lr/billing';
import { tables, withOrg, type Db, type Tx } from '@lr/db';
import { formatEuro } from '@lr/receipt-nl';
import { renderPdf } from '@lr/receipt-pdf';
import { DashboardError } from './errors.ts';
import { requireRole, type Actor } from './roles.ts';

/**
 * Merchant subscriptions (monthly or annual, demo payments only). Lifecycle: trialing → active → past_due → canceled.
 * Every organisation starts with a 14-day Business trial, created lazily on first access. Billing never blocks
 * receipt ingest or the archive: enforcement is limited to adding locations and terminals in the dashboard.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface BillingDeps {
  provider: PaymentProvider;
  now: () => Date;
}
export const defaultBillingDeps: BillingDeps = { provider: demoProvider, now: () => new Date() };

export const planChoiceInput = z.object({ plan: z.enum(PLANS), interval: z.enum(INTERVALS) }).strict();

/** What the checkout page posts. Card details are only passed to the provider: never stored, logged or audited. */
export const checkoutPaymentInput = z.discriminatedUnion('method', [
  z.object({ method: z.literal('card'), number: z.string().max(40), expiry: z.string().max(10), cvc: z.string().max(4) }).strict(),
  z.object({ method: z.literal('ideal'), bank: z.string().max(60) }).strict(),
]);

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const v = schema.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return v.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SubscriptionRow = typeof tables.subscriptions.$inferSelect;

/** The organisation's subscription, inserting the trial row on first access. Must run inside `withOrg` (or as the owner). */
export async function ensureSubscription(tx: Tx, orgId: string, now: Date): Promise<SubscriptionRow> {
  await tx
    .insert(tables.subscriptions)
    .values({ orgId, plan: TRIAL_PLAN, interval: 'monthly', status: 'trialing', trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS), createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  const [row] = await tx.select().from(tables.subscriptions).where(eq(tables.subscriptions.orgId, orgId));
  if (!row) throw new DashboardError('not_found', 'subscription not found');
  return row;
}

async function lockSubscription(tx: Tx, orgId: string, now: Date): Promise<SubscriptionRow> {
  await ensureSubscription(tx, orgId, now);
  const [row] = await tx.select().from(tables.subscriptions).where(eq(tables.subscriptions.orgId, orgId)).for('update');
  return row!;
}

const statusOf = (s: SubscriptionRow) => s.status as SubscriptionStatus;
const planOf = (s: SubscriptionRow) => s.plan as Plan;
const intervalOf = (s: SubscriptionRow) => s.interval as Interval;

// ------------------------------------------------------------------ reading

export interface BillingView {
  status: SubscriptionStatus;
  plan: Plan;
  interval: Interval;
  /** the plan whose features apply now (Business in a trial, null when canceled) */
  effectivePlan: Plan | null;
  limits: PlanLimits | null;
  usage: { locations: number; activeTerminals: number };
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingPlan: Plan | null;
  pendingInterval: Interval | null;
  pastDueSince: Date | null;
  /** past_due: the subscription ends at this moment unless a payment succeeds */
  graceEndsAt: Date | null;
  /** label of the active payment method, e.g. `Card •••• 4242` */
  method: string | null;
  /** the next charge: the renewal (active), or the next retry (past_due) */
  next: { at: Date; plan: Plan; interval: Interval; net: number; vat: number; gross: number } | null;
  vatRate: number;
}

async function usageOf(tx: Tx): Promise<{ locations: number; activeTerminals: number }> {
  const [l] = await tx.select({ n: count() }).from(tables.locations);
  const [t] = await tx.select({ n: count() }).from(tables.terminals).where(isNull(tables.terminals.revokedAt));
  return { locations: l?.n ?? 0, activeTerminals: t?.n ?? 0 };
}

function viewOf(s: SubscriptionRow, method: string | null, usage: BillingView['usage'], now: Date): BillingView {
  const status = statusOf(s);
  const eff = effectivePlan({ status, plan: planOf(s) });
  let next: BillingView['next'] = null;
  if (status === 'active' && !s.cancelAtPeriodEnd && s.currentPeriodEnd) {
    const plan = (s.pendingPlan ?? s.plan) as Plan;
    const interval = (s.pendingInterval ?? s.interval) as Interval;
    next = { at: s.currentPeriodEnd, plan, interval, ...priceFor(plan, interval) };
  } else if (status === 'past_due') {
    const at = s.lastChargeAttemptAt ? new Date(s.lastChargeAttemptAt.getTime() + RETRY_AFTER_HOURS * HOUR_MS) : now;
    next = { at, plan: planOf(s), interval: intervalOf(s), ...priceFor(planOf(s), intervalOf(s)) };
  }
  return {
    status,
    plan: planOf(s),
    interval: intervalOf(s),
    effectivePlan: eff,
    limits: eff ? planLimits(eff) : null,
    usage,
    trialEndsAt: s.trialEndsAt,
    trialDaysLeft: status === 'trialing' && s.trialEndsAt ? daysLeft(s.trialEndsAt, now) : null,
    currentPeriodStart: s.currentPeriodStart,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    pendingPlan: s.pendingPlan as Plan | null,
    pendingInterval: s.pendingInterval as Interval | null,
    pastDueSince: s.pastDueSince,
    graceEndsAt: status === 'past_due' && s.pastDueSince ? new Date(s.pastDueSince.getTime() + GRACE_DAYS * DAY_MS) : null,
    method,
    next,
    vatRate: VAT_RATE,
  };
}

/** The subscription as the Billing page shows it (owner, accountant). */
export async function getBilling(db: Db, actor: Actor, deps: BillingDeps = defaultBillingDeps): Promise<BillingView> {
  requireRole(actor, 'billing.read');
  const now = deps.now();
  return withOrg(db, actor.orgId, async (tx) => {
    const s = await ensureSubscription(tx, actor.orgId, now);
    const [m] = s.mandateId
      ? await tx
          .select({ label: tables.billingMandates.label })
          .from(tables.billingMandates)
          .where(and(eq(tables.billingMandates.id, s.mandateId), isNull(tables.billingMandates.revokedAt)))
      : [];
    return viewOf(s, m?.label ?? null, await usageOf(tx), now);
  });
}

export type BillingNotice = { kind: 'inactive' } | { kind: 'past_due' } | { kind: 'trial_ending'; daysLeft: number } | null;

/**
 * The banner every dashboard user sees (any role): plan inactive, payment failed, or the trial ends within 3 days.
 * Nothing else about the subscription is exposed to roles without `billing.read`.
 */
export async function billingNotice(db: Db, actor: Actor, deps: BillingDeps = defaultBillingDeps): Promise<BillingNotice> {
  const now = deps.now();
  const s = await withOrg(db, actor.orgId, (tx) => ensureSubscription(tx, actor.orgId, now));
  if (s.status === 'canceled') return { kind: 'inactive' };
  if (s.status === 'past_due') return { kind: 'past_due' };
  if (s.status === 'trialing' && s.trialEndsAt && s.trialEndsAt.getTime() - now.getTime() <= TRIAL_WARNING_DAYS * DAY_MS) return { kind: 'trial_ending', daysLeft: daysLeft(s.trialEndsAt, now) };
  return null;
}

// ------------------------------------------------------------------ enforcement (dashboard only)

const LIMIT_TEXT: Record<keyof PlanLimits, string> = { locations: 'location', activeTerminals: 'active terminal' };

/**
 * Refuses one more location or active terminal when the plan is inactive (`plan_inactive`) or at its limit
 * (`plan_limit`). Called inside the `withOrg` transaction of `createLocation` / `createTerminal`; the subscription row
 * stays locked until that transaction ends, so two requests at once cannot both take the last free slot.
 */
export async function assertPlanAllows(tx: Tx, orgId: string, kind: keyof PlanLimits, now: Date = new Date()): Promise<void> {
  const s = await lockSubscription(tx, orgId, now);
  const usage = await usageOf(tx);
  const check = checkLimit({ status: statusOf(s), plan: planOf(s) }, kind, usage[kind]);
  if (check.ok) return;
  if (check.reason === 'plan_inactive') throw new DashboardError('plan_inactive', 'your plan is inactive: choose a plan on the Billing page');
  throw new DashboardError('plan_limit', `your plan allows ${check.limit} ${LIMIT_TEXT[kind]}${check.limit === 1 ? '' : 's'}: upgrade on the Billing page`);
}

// ------------------------------------------------------------------ checkout

/** Opens a checkout (payment session, valid 30 minutes) for a trialing, canceled or past_due subscription. */
export async function startCheckout(db: Db, actor: Actor, input: unknown, deps: BillingDeps = defaultBillingDeps): Promise<{ id: string }> {
  requireRole(actor, 'billing.write');
  const choice = parse(planChoiceInput, input);
  const now = deps.now();
  return withOrg(db, actor.orgId, async (tx) => {
    const s = await ensureSubscription(tx, actor.orgId, now);
    if (s.status === 'active') throw new DashboardError('conflict', 'the subscription is active: schedule a change instead');
    const amounts = priceFor(choice.plan, choice.interval);
    const [row] = await tx
      .insert(tables.paymentSessions)
      .values({
        orgId: actor.orgId,
        plan: choice.plan,
        interval: choice.interval,
        netMinor: amounts.net,
        vatMinor: amounts.vat,
        grossMinor: amounts.gross,
        createdBy: actor.userId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MINUTES * 60_000),
      })
      .returning({ id: tables.paymentSessions.id });
    await tx.insert(tables.auditLog).values({ event: 'billing_checkout_started', orgId: actor.orgId, detail: { userId: actor.userId, sessionId: row!.id, ...choice } });
    return { id: row!.id };
  });
}

export interface CheckoutView {
  id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  failureReason: string | null;
  merchantName: string;
  plan: Plan;
  interval: Interval;
  net: number;
  vat: number;
  gross: number;
  vatRate: number;
  currency: string;
  /** the period this payment would cover if paid now */
  periodStart: Date;
  periodEnd: Date;
  expiresAt: Date;
}

type SessionRow = typeof tables.paymentSessions.$inferSelect;

async function findSession(tx: Tx, id: string, lock: boolean): Promise<SessionRow> {
  if (!UUID_RE.test(id)) throw new DashboardError('not_found', 'checkout not found');
  const q = tx.select().from(tables.paymentSessions).where(eq(tables.paymentSessions.id, id));
  const [row] = lock ? await q.for('update') : await q;
  // RLS: another organisation's checkout is simply not there
  if (!row) throw new DashboardError('not_found', 'checkout not found');
  return row;
}

/** A pending checkout past its 30 minutes becomes `expired` when it is next looked at. */
async function expireIfDue(tx: Tx, row: SessionRow, now: Date): Promise<SessionRow> {
  if (row.status !== 'pending' || row.expiresAt.getTime() > now.getTime()) return row;
  const [updated] = await tx.update(tables.paymentSessions).set({ status: 'expired' }).where(eq(tables.paymentSessions.id, row.id)).returning();
  return updated!;
}

/** The checkout page: merchant name and the summary. Another organisation's checkout is `not_found`. */
export async function getCheckout(db: Db, actor: Actor, id: string, deps: BillingDeps = defaultBillingDeps): Promise<CheckoutView> {
  requireRole(actor, 'billing.write');
  const now = deps.now();
  return withOrg(db, actor.orgId, async (tx) => {
    const row = await expireIfDue(tx, await findSession(tx, id, true), now);
    const [org] = await tx.select({ legalName: tables.organizations.legalName }).from(tables.organizations);
    const interval = row.interval as Interval;
    return {
      id: row.id,
      status: row.status as CheckoutView['status'],
      failureReason: row.failureReason,
      merchantName: org?.legalName ?? '',
      plan: row.plan as Plan,
      interval,
      net: row.netMinor,
      vat: row.vatMinor,
      gross: row.grossMinor,
      vatRate: VAT_RATE,
      currency: row.currency,
      periodStart: now,
      periodEnd: addInterval(now, interval),
      expiresAt: row.expiresAt,
    };
  });
}

async function nextInvoiceNumber(tx: Tx, now: Date): Promise<string> {
  const r = await tx.execute<{ n: string }>(sql`select nextval('merchant.invoice_number_seq')::text as n`);
  return `LR-${amsterdamYear(now)}-${r.rows[0]!.n.padStart(6, '0')}`;
}

export type CheckoutResult = { status: 'paid'; invoiceId: string } | { status: 'failed'; reason: string };

/**
 * Pays a pending checkout with the (demo) provider. Paid: a mandate for renewals, the subscription becomes `active`
 * with a period starting now, and a paid invoice. Declined: the checkout is `failed` and the subscription is unchanged.
 */
export async function completeDemoCheckout(db: Db, actor: Actor, id: string, input: unknown, deps: BillingDeps = defaultBillingDeps): Promise<CheckoutResult> {
  requireRole(actor, 'billing.write');
  const method = parse(checkoutPaymentInput, input);
  const now = deps.now();
  const problems = methodProblems(method, now);
  if (problems.length) throw new DashboardError('validation', problems.join('; '));
  return withOrg(db, actor.orgId, async (tx) => {
    const row = await expireIfDue(tx, await findSession(tx, id, true), now);
    if (row.status === 'expired') throw new DashboardError('conflict', 'checkout expired');
    if (row.status !== 'pending') throw new DashboardError('conflict', 'checkout already completed');
    const s = await lockSubscription(tx, actor.orgId, now);
    if (s.status === 'active') throw new DashboardError('conflict', 'the subscription is already active');

    const plan = row.plan as Plan;
    const interval = row.interval as Interval;
    const amounts = { net: row.netMinor, vat: row.vatMinor, gross: row.grossMinor };
    const result = await deps.provider.firstPayment({ amounts, currency: 'EUR', description: `Verumly ${plan} (${interval})` }, method);

    if (result.status === 'failed') {
      await tx.update(tables.paymentSessions).set({ status: 'failed', failureReason: result.reason, completedAt: now }).where(eq(tables.paymentSessions.id, row.id));
      await tx.insert(tables.auditLog).values({ event: 'billing_payment_failed', orgId: actor.orgId, detail: { userId: actor.userId, sessionId: row.id, method: method.method, reason: result.reason } });
      return { status: 'failed', reason: result.reason };
    }

    // one active mandate per organisation: the new one replaces any earlier one
    await tx.update(tables.billingMandates).set({ revokedAt: now }).where(isNull(tables.billingMandates.revokedAt));
    const [mandate] = await tx
      .insert(tables.billingMandates)
      .values({ orgId: actor.orgId, method: result.mandate.method, label: result.mandate.label, failsRenewals: result.mandate.failsRenewals, createdAt: now })
      .returning({ id: tables.billingMandates.id });
    const periodEnd = addInterval(now, interval);
    await tx
      .update(tables.subscriptions)
      .set({
        plan,
        interval,
        status: 'active',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        pendingPlan: null,
        pendingInterval: null,
        mandateId: mandate!.id,
        pastDueSince: null,
        lastChargeAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(tables.subscriptions.orgId, actor.orgId));
    const [invoice] = await tx
      .insert(tables.invoices)
      .values({
        orgId: actor.orgId,
        number: await nextInvoiceNumber(tx, now),
        plan,
        interval,
        periodStart: now,
        periodEnd,
        netMinor: amounts.net,
        vatRate: VAT_RATE,
        vatMinor: amounts.vat,
        grossMinor: amounts.gross,
        status: 'paid',
        methodLabel: result.mandate.label,
        paidAt: now,
        createdAt: now,
      })
      .returning({ id: tables.invoices.id });
    await tx.update(tables.paymentSessions).set({ status: 'paid', completedAt: now }).where(eq(tables.paymentSessions.id, row.id));
    await tx.insert(tables.auditLog).values({
      event: 'billing_paid',
      orgId: actor.orgId,
      detail: { userId: actor.userId, sessionId: row.id, invoiceId: invoice!.id, plan, interval, method: result.mandate.method, previousStatus: s.status },
    });
    return { status: 'paid', invoiceId: invoice!.id };
  });
}

// ------------------------------------------------------------------ changes on an active subscription

async function mutateActive(db: Db, actor: Actor, now: Date, fn: (tx: Tx, s: SubscriptionRow) => Promise<void>): Promise<void> {
  requireRole(actor, 'billing.write');
  await withOrg(db, actor.orgId, async (tx) => {
    const s = await lockSubscription(tx, actor.orgId, now);
    if (s.status !== 'active') throw new DashboardError('conflict', 'the subscription is not active');
    await fn(tx, s);
  });
}

/** Plan or interval change on an active subscription: scheduled for the next renewal, no proration. */
export async function scheduleChange(db: Db, actor: Actor, input: unknown, deps: BillingDeps = defaultBillingDeps): Promise<void> {
  const choice = parse(planChoiceInput, input);
  const now = deps.now();
  await mutateActive(db, actor, now, async (tx, s) => {
    if (s.cancelAtPeriodEnd) throw new DashboardError('conflict', 'the subscription ends at the end of the period: resume it first');
    if (choice.plan === s.plan && choice.interval === s.interval) throw new DashboardError('validation', 'that is the current plan');
    await tx.update(tables.subscriptions).set({ pendingPlan: choice.plan, pendingInterval: choice.interval, updatedAt: now }).where(eq(tables.subscriptions.orgId, actor.orgId));
    await tx.insert(tables.auditLog).values({ event: 'billing_change_scheduled', orgId: actor.orgId, detail: { userId: actor.userId, from: { plan: s.plan, interval: s.interval }, to: choice } });
  });
}

export async function undoChange(db: Db, actor: Actor, deps: BillingDeps = defaultBillingDeps): Promise<void> {
  const now = deps.now();
  await mutateActive(db, actor, now, async (tx, s) => {
    if (!s.pendingPlan && !s.pendingInterval) throw new DashboardError('conflict', 'no change is scheduled');
    await tx.update(tables.subscriptions).set({ pendingPlan: null, pendingInterval: null, updatedAt: now }).where(eq(tables.subscriptions.orgId, actor.orgId));
    await tx.insert(tables.auditLog).values({ event: 'billing_change_undone', orgId: actor.orgId, detail: { userId: actor.userId, plan: s.pendingPlan, interval: s.pendingInterval } });
  });
}

/** Cancel at the end of the paid period; until then `resume` undoes it. */
export async function cancelSubscription(db: Db, actor: Actor, deps: BillingDeps = defaultBillingDeps): Promise<void> {
  const now = deps.now();
  await mutateActive(db, actor, now, async (tx, s) => {
    if (s.cancelAtPeriodEnd) return;
    await tx.update(tables.subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: now }).where(eq(tables.subscriptions.orgId, actor.orgId));
    await tx.insert(tables.auditLog).values({ event: 'billing_canceled', orgId: actor.orgId, detail: { userId: actor.userId, endsAt: s.currentPeriodEnd?.toISOString() ?? null } });
  });
}

export async function resumeSubscription(db: Db, actor: Actor, deps: BillingDeps = defaultBillingDeps): Promise<void> {
  const now = deps.now();
  await mutateActive(db, actor, now, async (tx, s) => {
    if (!s.cancelAtPeriodEnd) return;
    if (!s.currentPeriodEnd || s.currentPeriodEnd.getTime() <= now.getTime()) throw new DashboardError('conflict', 'the period has ended');
    await tx.update(tables.subscriptions).set({ cancelAtPeriodEnd: false, updatedAt: now }).where(eq(tables.subscriptions.orgId, actor.orgId));
    await tx.insert(tables.auditLog).values({ event: 'billing_resumed', orgId: actor.orgId, detail: { userId: actor.userId } });
  });
}

// ------------------------------------------------------------------ renewals (worker, and the demo "simulate" button)

export type RenewalAction = 'renewed' | 'renewal_failed' | 'ended' | 'skipped';

async function insertInvoice(tx: Tx, s: SubscriptionRow, o: { plan: Plan; interval: Interval; periodStart: Date; periodEnd: Date; status: 'paid' | 'failed'; methodLabel: string | null; now: Date }) {
  const amounts = priceFor(o.plan, o.interval);
  await tx.insert(tables.invoices).values({
    orgId: s.orgId,
    number: await nextInvoiceNumber(tx, o.now),
    plan: o.plan,
    interval: o.interval,
    periodStart: o.periodStart,
    periodEnd: o.periodEnd,
    netMinor: amounts.net,
    vatRate: VAT_RATE,
    vatMinor: amounts.vat,
    grossMinor: amounts.gross,
    status: o.status,
    methodLabel: o.methodLabel,
    paidAt: o.status === 'paid' ? o.now : null,
    createdAt: o.now,
  });
}

async function endSubscription(tx: Tx, s: SubscriptionRow, now: Date, reason: 'trial_ended' | 'canceled' | 'unpaid'): Promise<RenewalAction> {
  await tx
    .update(tables.subscriptions)
    .set({ status: 'canceled', cancelAtPeriodEnd: false, pendingPlan: null, pendingInterval: null, pastDueSince: null, updatedAt: now })
    .where(eq(tables.subscriptions.orgId, s.orgId));
  await tx.insert(tables.auditLog).values({ event: 'billing_ended', orgId: s.orgId, detail: { reason, plan: s.plan } });
  return 'ended';
}

/** Charges the mandate for the period starting at the current period end (with any scheduled change applied). */
async function chargeRenewal(tx: Tx, s: SubscriptionRow, now: Date, provider: PaymentProvider): Promise<RenewalAction> {
  const plan = (s.pendingPlan ?? s.plan) as Plan;
  const interval = (s.pendingInterval ?? s.interval) as Interval;
  const periodStart = s.currentPeriodEnd!;
  const periodEnd = addInterval(periodStart, interval);
  const [m] = s.mandateId
    ? await tx
        .select()
        .from(tables.billingMandates)
        .where(and(eq(tables.billingMandates.id, s.mandateId), isNull(tables.billingMandates.revokedAt)))
    : [];
  const mandate: Mandate | null = m ? { method: m.method as PaymentMethod, label: m.label, failsRenewals: m.failsRenewals } : null;
  const result = mandate
    ? await provider.chargeMandate({ amounts: priceFor(plan, interval), currency: 'EUR', description: `Verumly ${plan} (${interval})` }, mandate)
    : ({ status: 'failed', reason: 'no_mandate' } as const);
  const base = { plan, interval, pendingPlan: null, pendingInterval: null, lastChargeAttemptAt: now, updatedAt: now };

  if (result.status === 'paid') {
    await insertInvoice(tx, s, { plan, interval, periodStart, periodEnd, status: 'paid', methodLabel: mandate!.label, now });
    await tx
      .update(tables.subscriptions)
      .set({ ...base, status: 'active', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, pastDueSince: null })
      .where(eq(tables.subscriptions.orgId, s.orgId));
    await tx.insert(tables.auditLog).values({ event: 'billing_renewed', orgId: s.orgId, detail: { plan, interval, periodStart: periodStart.toISOString(), changed: Boolean(s.pendingPlan || s.pendingInterval) } });
    return 'renewed';
  }
  await insertInvoice(tx, s, { plan, interval, periodStart, periodEnd, status: 'failed', methodLabel: mandate?.label ?? null, now });
  await tx
    .update(tables.subscriptions)
    .set({ ...base, status: 'past_due', pastDueSince: s.pastDueSince ?? now })
    .where(eq(tables.subscriptions.orgId, s.orgId));
  await tx.insert(tables.auditLog).values({ event: 'billing_renewal_failed', orgId: s.orgId, detail: { plan, interval, reason: result.reason, attempt: s.status === 'past_due' ? 'retry' : 'renewal' } });
  return 'renewal_failed';
}

/**
 * One step of the lifecycle for one organisation, on a row locked `FOR UPDATE` (so two workers never charge twice):
 * trial over → canceled; period over → canceled (cancel at period end) or renewal charge; past_due → retry once per
 * 24 h, canceled after 7 days. Anything not yet due is `skipped`.
 */
export async function renewSubscription(tx: Tx, orgId: string, now: Date, provider: PaymentProvider): Promise<RenewalAction> {
  const [s] = await tx.select().from(tables.subscriptions).where(eq(tables.subscriptions.orgId, orgId)).for('update');
  if (!s) return 'skipped';
  const t = now.getTime();
  switch (statusOf(s)) {
    case 'trialing':
      return s.trialEndsAt && s.trialEndsAt.getTime() <= t ? endSubscription(tx, s, now, 'trial_ended') : 'skipped';
    case 'active':
      if (!s.currentPeriodEnd || s.currentPeriodEnd.getTime() > t) return 'skipped';
      return s.cancelAtPeriodEnd ? endSubscription(tx, s, now, 'canceled') : chargeRenewal(tx, s, now, provider);
    case 'past_due':
      if (s.pastDueSince && s.pastDueSince.getTime() + GRACE_DAYS * DAY_MS <= t) return endSubscription(tx, s, now, 'unpaid');
      if (s.lastChargeAttemptAt && s.lastChargeAttemptAt.getTime() + RETRY_AFTER_HOURS * HOUR_MS > t) return 'skipped';
      return chargeRenewal(tx, s, now, provider);
    case 'canceled':
      return 'skipped';
  }
}

/** Every subscription with something due, each in its own transaction (worker role: all organisations). */
export async function runRenewals(db: Db, now: Date, provider: PaymentProvider): Promise<Record<RenewalAction, number>> {
  const iso = now.toISOString();
  const due = await db.execute<{ org_id: string }>(sql`
    select org_id from merchant.subscriptions
    where (status = 'trialing' and trial_ends_at <= ${iso}::timestamptz)
       or (status = 'active' and current_period_end <= ${iso}::timestamptz)
       or (status = 'past_due' and (past_due_since <= ${iso}::timestamptz - make_interval(days => ${GRACE_DAYS})
                                    or last_charge_attempt_at is null
                                    or last_charge_attempt_at <= ${iso}::timestamptz - make_interval(hours => ${RETRY_AFTER_HOURS})))
    order by org_id
  `);
  const out: Record<RenewalAction, number> = { renewed: 0, renewal_failed: 0, ended: 0, skipped: 0 };
  for (const { org_id } of due.rows) out[await db.transaction((tx) => renewSubscription(tx, org_id, now, provider))]++;
  return out;
}

/**
 * Demo only (the web layer allows it when DEMO_MODE is on): pretend the period ends now and run the renewal for this
 * organisation immediately, so the renewal and the past_due flow can be shown live. In past_due it retries at once.
 */
export async function simulateRenewal(db: Db, actor: Actor, deps: BillingDeps = defaultBillingDeps): Promise<RenewalAction> {
  requireRole(actor, 'billing.write');
  const now = deps.now();
  return withOrg(db, actor.orgId, async (tx) => {
    const s = await lockSubscription(tx, actor.orgId, now);
    if (s.status === 'active') await tx.update(tables.subscriptions).set({ currentPeriodEnd: now, updatedAt: now }).where(eq(tables.subscriptions.orgId, actor.orgId));
    else if (s.status === 'past_due') await tx.update(tables.subscriptions).set({ lastChargeAttemptAt: null, updatedAt: now }).where(eq(tables.subscriptions.orgId, actor.orgId));
    else throw new DashboardError('conflict', 'there is no paid period to renew');
    return renewSubscription(tx, actor.orgId, now, deps.provider);
  });
}

// ------------------------------------------------------------------ invoices

const invoiceCols = {
  id: tables.invoices.id,
  number: tables.invoices.number,
  plan: tables.invoices.plan,
  interval: tables.invoices.interval,
  periodStart: tables.invoices.periodStart,
  periodEnd: tables.invoices.periodEnd,
  net: tables.invoices.netMinor,
  vatRate: tables.invoices.vatRate,
  vat: tables.invoices.vatMinor,
  gross: tables.invoices.grossMinor,
  status: tables.invoices.status,
  methodLabel: tables.invoices.methodLabel,
  paidAt: tables.invoices.paidAt,
  createdAt: tables.invoices.createdAt,
};

export async function listInvoices(db: Db, actor: Actor) {
  requireRole(actor, 'billing.read');
  return withOrg(db, actor.orgId, (tx) => tx.select(invoiceCols).from(tables.invoices).orderBy(desc(tables.invoices.createdAt), desc(tables.invoices.number)));
}

const PLAN_NAME: Record<Plan, string> = { starter: 'Starter', business: 'Business' };
const INTERVAL_NAME: Record<Interval, string> = { monthly: 'monthly', annual: 'annual' };
const amsterdamDate = (d: Date) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Europe/Amsterdam' }).format(d);

/** The invoice as a PDF (A4), drawn with the same pdfmake setup as the receipt PDFs. */
export async function invoicePdf(db: Db, actor: Actor, id: string): Promise<{ number: string; pdf: Uint8Array }> {
  requireRole(actor, 'billing.read');
  if (!UUID_RE.test(id)) throw new DashboardError('not_found', 'invoice not found');
  const found = await withOrg(db, actor.orgId, async (tx) => {
    const [inv] = await tx.select(invoiceCols).from(tables.invoices).where(eq(tables.invoices.id, id));
    const [org] = await tx.select({ legalName: tables.organizations.legalName, kvkNumber: tables.organizations.kvkNumber, vatNumber: tables.organizations.vatNumber }).from(tables.organizations);
    return inv && org ? { inv, org } : null;
  });
  if (!found) throw new DashboardError('not_found', 'invoice not found');
  const { inv, org } = found;
  const muted = { color: '#6b6b78', fontSize: 9 };
  const row = (label: string, value: string, bold = false) => [{ text: label, bold }, { text: value, alignment: 'right', bold }];
  const definition = {
    info: { title: `Invoice ${inv.number}`, producer: 'Verumly' },
    pageSize: 'A4',
    pageMargins: [56, 56, 56, 56],
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#1d1d24' },
    content: [
      { text: 'DEMO INVOICE · no money moved', alignment: 'center', bold: true, color: '#7A5A10', fontSize: 9, margin: [0, 0, 0, 16] },
      {
        columns: [
          { stack: [{ text: 'Verumly', bold: true, fontSize: 16 }, { text: 'Digital receipts for the Netherlands', ...muted }] },
          { stack: [{ text: 'Invoice', bold: true, fontSize: 16, alignment: 'right' }, { text: inv.number, alignment: 'right', ...muted }] },
        ],
      },
      { text: 'Billed to', ...muted, margin: [0, 24, 0, 2] },
      { text: org.legalName, bold: true },
      { text: `KvK ${org.kvkNumber}${org.vatNumber ? `  ·  BTW-id ${org.vatNumber}` : ''}`, ...muted },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            row('Invoice date', amsterdamDate(inv.createdAt)),
            row('Period', `${amsterdamDate(inv.periodStart)} – ${amsterdamDate(inv.periodEnd)}`),
            row('Status', inv.status === 'paid' ? `Paid${inv.paidAt ? ` on ${amsterdamDate(inv.paidAt)}` : ''}${inv.methodLabel ? ` · ${inv.methodLabel}` : ''}` : 'Not paid: the payment failed'),
          ],
        },
        layout: 'noBorders',
        margin: [0, 18, 0, 18],
      },
      {
        table: {
          widths: ['*', 'auto'],
          headerRows: 1,
          body: [
            [{ text: 'Description', ...muted }, { text: 'Amount', alignment: 'right', ...muted }],
            row(`Verumly ${PLAN_NAME[inv.plan as Plan]} plan, ${INTERVAL_NAME[inv.interval as Interval]}`, formatEuro(inv.net)),
            row('Subtotal excl. BTW', formatEuro(inv.net)),
            row(`BTW ${inv.vatRate}%`, formatEuro(inv.vat)),
            row('Total incl. BTW', formatEuro(inv.gross), true),
          ],
        },
        layout: 'lightHorizontalLines',
      },
      { text: 'Generated by the Verumly demo. Not a tax invoice.', ...muted, margin: [0, 24, 0, 0] },
    ],
  };
  return { number: inv.number, pdf: await renderPdf(definition) };
}
