import { listInvoices } from '@lr/dashboard-core';

export default dashboardHandler('billing.read', ({ actor, ctx }) => listInvoices(ctx.deps.db, actor));
