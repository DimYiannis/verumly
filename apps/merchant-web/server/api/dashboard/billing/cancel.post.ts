import { cancelSubscription } from '@lr/dashboard-core';

/** Cancels at the end of the paid period. */
export default dashboardHandler('billing.write', async ({ actor, ctx }) => {
  await cancelSubscription(ctx.deps.db, actor, ctx.billing);
  return { ok: true };
});
