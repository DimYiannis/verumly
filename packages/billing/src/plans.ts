/** Merchant subscription plans. Prices are euro cents **excluding** BTW (B2B); see `vatSplit` for the 21% on top. */

export const PLANS = ['starter', 'business'] as const;
export type Plan = (typeof PLANS)[number];

export const INTERVALS = ['monthly', 'annual'] as const;
export type Interval = (typeof INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface PlanLimits {
  /** null: unlimited */
  locations: number | null;
  /** terminals that are not revoked; null: unlimited */
  activeTerminals: number | null;
}

export interface PlanDefinition {
  id: Plan;
  /** net prices in euro cents */
  prices: Record<Interval, number>;
  limits: PlanLimits;
}

export const CATALOGUE: Record<Plan, PlanDefinition> = {
  // annual = 10 × monthly: two months free
  starter: { id: 'starter', prices: { monthly: 1900, annual: 19000 }, limits: { locations: 1, activeTerminals: 2 } },
  business: { id: 'business', prices: { monthly: 4900, annual: 49000 }, limits: { locations: null, activeTerminals: null } },
};

export const TRIAL_DAYS = 14;
/** the plan whose features a trial gets */
export const TRIAL_PLAN: Plan = 'business';
/** a failed renewal is retried once per this many hours */
export const RETRY_AFTER_HOURS = 24;
/** days in `past_due` before the subscription ends */
export const GRACE_DAYS = 7;
/** a checkout (payment session) is open this long */
export const CHECKOUT_TTL_MINUTES = 30;
/** banner from this many days before the trial ends */
export const TRIAL_WARNING_DAYS = 3;

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && (PLANS as readonly string[]).includes(v);
export const isInterval = (v: unknown): v is Interval => typeof v === 'string' && (INTERVALS as readonly string[]).includes(v);

export function netPrice(plan: Plan, interval: Interval): number {
  return CATALOGUE[plan].prices[interval];
}

export function planLimits(plan: Plan): PlanLimits {
  return CATALOGUE[plan].limits;
}

/** Monthly equivalent of the annual price, rounded half-up to the cent (for "€X per month, billed yearly"). */
export function monthlyEquivalent(plan: Plan): number {
  return Math.floor((CATALOGUE[plan].prices.annual * 2 + 12) / 24);
}

/** What an annual price saves against twelve monthly payments, in cents (net). */
export function annualSaving(plan: Plan): number {
  return CATALOGUE[plan].prices.monthly * 12 - CATALOGUE[plan].prices.annual;
}

/**
 * The plan whose features apply now: a trial gets Business, an inactive (canceled) subscription gets nothing,
 * `active` and `past_due` keep their plan (past_due is a grace period, not a downgrade).
 */
export function effectivePlan(s: { status: SubscriptionStatus; plan: Plan }): Plan | null {
  if (s.status === 'canceled') return null;
  if (s.status === 'trialing') return TRIAL_PLAN;
  return s.plan;
}

export type LimitCheck = { ok: true } | { ok: false; reason: 'plan_inactive' | 'plan_limit'; limit?: number };

/** May the organisation add one more location / active terminal, given what it has now? */
export function checkLimit(s: { status: SubscriptionStatus; plan: Plan }, kind: keyof PlanLimits, current: number): LimitCheck {
  const plan = effectivePlan(s);
  if (!plan) return { ok: false, reason: 'plan_inactive' };
  const limit = planLimits(plan)[kind];
  if (limit !== null && current >= limit) return { ok: false, reason: 'plan_limit', limit };
  return { ok: true };
}
