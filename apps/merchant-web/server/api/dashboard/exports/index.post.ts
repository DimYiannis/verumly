import { requestExport } from '@lr/dashboard-core';

export default dashboardHandler('exports.create', async ({ event, actor, ctx }) => requestExport(ctx.deps.db, await getBoss(), actor, await readBody(event)));
