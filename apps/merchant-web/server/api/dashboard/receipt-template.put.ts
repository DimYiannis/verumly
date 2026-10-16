import { updateReceiptTemplate } from '@lr/dashboard-core';

export default dashboardHandler('org.write', async ({ event, actor, ctx }) => ({ template: await updateReceiptTemplate(ctx.deps.db, actor, await readBody(event)) }));
