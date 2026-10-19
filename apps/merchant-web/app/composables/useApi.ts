import { getFormat } from '@lr/compliance/formats';
import { formatEuro } from '@lr/receipt-nl';

/** Human-readable message from a failed `$fetch` (Nitro puts the reason in `statusMessage`). */
export function errorMessage(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    if ('statusMessage' in e && typeof e.statusMessage === 'string' && e.statusMessage) return e.statusMessage;
    if ('data' in e && typeof e.data === 'object' && e.data !== null && 'statusMessage' in e.data && typeof e.data.statusMessage === 'string') return e.data.statusMessage;
    if ('message' in e && typeof e.message === 'string') return e.message;
  }
  return 'Something went wrong';
}

export type Role = 'owner' | 'manager' | 'accountant';

export interface SessionUser {
  email: string;
  role: Role;
  orgName: string;
  /** ISO country of the organisation: decides the currency and time zone shown */
  country?: string;
}

export interface SessionState {
  state: 'anonymous' | 'mfa_enrol' | 'mfa_verify' | 'ready';
  user?: SessionUser;
}

export const sessionState = () => useState<SessionState>('dashboard-session', () => ({ state: 'anonymous' }));

export async function refreshSession(): Promise<SessionState> {
  const s = await $fetch<SessionState>('/api/dashboard/session');
  sessionState().value = s;
  return s;
}

/** Wraps a request: sets `error` on failure, returns undefined. */
export async function attempt<T>(error: Ref<string>, fn: () => Promise<T>): Promise<T | undefined> {
  error.value = '';
  try {
    return await fn();
  } catch (e) {
    error.value = errorMessage(e);
    return undefined;
  }
}

/** Euro, for what Syngrapha charges (plans, invoices): always EUR, whatever the country of the business. */
export function euro(cents: number): string {
  return formatEuro(cents);
}

/** The business's own format: currency and time zone of its country (Dutch euro, Amsterdam, until the session says otherwise). */
export function orgFormat() {
  return getFormat(sessionState().value.user?.country ?? 'NL') ?? getFormat('NL')!;
}

/** Receipt amounts of the business (minor units) in the currency of its country. */
export function money(minor: number): string {
  const f = orgFormat();
  if (f.code === 'NL') return formatEuro(minor);
  return new Intl.NumberFormat(f.locale, { style: 'currency', currency: f.currency }).format(minor / 100);
}

/** Date and time in the time zone of the business's country. (Named after the Dutch default it started as.) */
export function amsterdam(iso: string | Date): string {
  return new Intl.DateTimeFormat(useLocale().intlLocale.value, { dateStyle: 'short', timeStyle: 'medium', timeZone: orgFormat().timezone }).format(new Date(iso));
}

/** A date (no time) on the calendar of the business's time zone, in the chosen language. */
export function amsterdamDay(iso: string | Date): string {
  return new Intl.DateTimeFormat(useLocale().intlLocale.value, { dateStyle: 'medium', timeZone: orgFormat().timezone }).format(new Date(iso));
}

export type PlanRefusal = 'plan_limit' | 'plan_inactive';

/** The dashboard refuses a new location or terminal with 402 and `data.code` = plan_limit / plan_inactive. */
export function planRefusal(e: unknown): PlanRefusal | null {
  if (typeof e !== 'object' || e === null || !('data' in e)) return null;
  const body = e.data;
  const data = typeof body === 'object' && body !== null && 'data' in body ? body.data : null;
  const code = typeof data === 'object' && data !== null && 'code' in data ? data.code : null;
  return code === 'plan_limit' || code === 'plan_inactive' ? code : null;
}

/** Like `attempt`, but a plan refusal lands in `refusal` (the page shows it with a link to Billing) instead of `error`. */
export async function attemptPlan<T>(error: Ref<string>, refusal: Ref<PlanRefusal | null>, fn: () => Promise<T>): Promise<T | undefined> {
  error.value = '';
  refusal.value = null;
  try {
    return await fn();
  } catch (e) {
    const code = planRefusal(e);
    if (code) refusal.value = code;
    else error.value = errorMessage(e);
    return undefined;
  }
}

export type BillingNotice = { kind: 'inactive' } | { kind: 'past_due' } | { kind: 'trial_ending'; daysLeft: number } | null;

export const billingNotice = () => useState<BillingNotice>('billing-notice', () => null);

/** Reloads the plan banner (after sign-in, navigation, or a change on the Billing page). Failures keep the last state. */
export async function refreshBillingNotice(): Promise<void> {
  try {
    billingNotice().value = (await $fetch<{ notice: BillingNotice }>('/api/dashboard/billing/notice')).notice;
  } catch {
    /* banner only: the page itself reports errors */
  }
}
