import { listReportViews } from '@lr/dashboard-core';

export default dashboardHandler('reports.read', ({ actor, ctx }) => listReportViews(ctx.deps.db, actor));
