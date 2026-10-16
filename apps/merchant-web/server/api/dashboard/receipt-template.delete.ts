import { resetReceiptTemplate } from '@lr/dashboard-core';

export default dashboardHandler('org.write', async ({ actor, ctx }) => {
  await resetReceiptTemplate(ctx.deps.db, actor);
  return { template: null };
});
