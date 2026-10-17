import { runRenewals, type RenewalAction } from '@lr/dashboard-core';
import type { WorkerCtx } from '../context.ts';

/**
 * Merchant subscriptions, every 15 minutes, safe to run any number of times: trials that ran out and periods that
 * ended with "cancel at period end" become `canceled`; ended periods are renewed on the stored mandate (a scheduled
 * plan change applies first); a failed charge makes the subscription `past_due`, retried once per 24 h and canceled
 * after 7 days. Each subscription is processed on a row lock, and a period can only be paid once (unique index).
 */
export async function billingRenewals(ctx: WorkerCtx): Promise<Record<RenewalAction, number>> {
  const out = await runRenewals(ctx.db, ctx.now(), ctx.payments);
  ctx.log('billing_renewals', { ...out });
  return out;
}
