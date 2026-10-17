import { startCheckout } from '@lr/dashboard-core';

/** Opens a checkout for `{ plan, interval }`; the page then goes to /billing/checkout/<id>. */
export default dashboardHandler('billing.write', async ({ event, actor, ctx }) => startCheckout(ctx.deps.db, actor, await readBody(event), ctx.billing));
