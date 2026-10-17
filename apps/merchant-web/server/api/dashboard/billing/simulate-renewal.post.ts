import { simulateRenewal } from '@lr/dashboard-core';

/** Demo only: end the period now and renew immediately (404 unless BILLING_SIMULATE_RENEWAL, which follows DEMO_MODE). */
export default dashboardHandler('billing.write', async ({ actor, ctx }) => {
  if (!useEnv().billingSimulation) throw createError({ statusCode: 404, statusMessage: 'not found' });
  return { result: await simulateRenewal(ctx.deps.db, actor, ctx.billing) };
});
