import { getReceiptTemplate } from '@lr/dashboard-core';

export default dashboardHandler('org.read', async ({ actor, ctx }) => ({ template: await getReceiptTemplate(ctx.deps.db, actor) }));
