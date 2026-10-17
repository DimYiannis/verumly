import { resumeSubscription } from '@lr/dashboard-core';

export default dashboardHandler('billing.write', async ({ actor, ctx }) => {
  await resumeSubscription(ctx.deps.db, actor, ctx.billing);
  return { ok: true };
});
