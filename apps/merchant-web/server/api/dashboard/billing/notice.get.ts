import { billingNotice } from '@lr/dashboard-core';

/** The banner state (plan inactive, payment failed, trial ending) for every signed-in role. */
export default dashboardHandler(null, async ({ actor, ctx }) => ({ notice: await billingNotice(ctx.deps.db, actor, ctx.billing) }));
