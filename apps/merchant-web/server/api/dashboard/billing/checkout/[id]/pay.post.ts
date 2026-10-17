import { completeDemoCheckout } from '@lr/dashboard-core';

/** Pays the checkout with the demo provider. Card details pass through to the provider only: never stored or logged. */
export default dashboardHandler('billing.write', async ({ event, actor, ctx }) => completeDemoCheckout(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '', await readBody(event), ctx.billing));
