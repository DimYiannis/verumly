import { updateOrganization } from '@lr/dashboard-core';

export default dashboardHandler('org.write', async ({ event, actor, ctx }) => updateOrganization(ctx.deps.db, actor, await readBody(event)));
