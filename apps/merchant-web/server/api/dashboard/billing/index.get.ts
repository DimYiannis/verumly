import { getBilling } from '@lr/dashboard-core';

/** The subscription for the Billing page (owner, accountant), and whether the demo renewal button is on. */
export default dashboardHandler('billing.read', async ({ actor, ctx }) => ({ ...(await getBilling(ctx.deps.db, actor, ctx.billing)), canSimulateRenewal: useEnv().billingSimulation }));
