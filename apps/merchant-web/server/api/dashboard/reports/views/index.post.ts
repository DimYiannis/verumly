import { createReportView } from '@lr/dashboard-core';

export default dashboardHandler('reports.read', async ({ event, actor, ctx }) => createReportView(ctx.deps.db, actor, await readBody(event)));
