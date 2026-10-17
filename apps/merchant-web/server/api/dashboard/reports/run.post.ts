import { runReport } from '@lr/dashboard-core';

export default dashboardHandler('reports.read', async ({ event, actor, ctx }) => runReport(ctx.deps.db, actor, await readBody(event)));
