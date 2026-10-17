import { getCheckout } from '@lr/dashboard-core';

export default dashboardHandler('billing.write', ({ event, actor, ctx }) => getCheckout(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '', ctx.billing));
