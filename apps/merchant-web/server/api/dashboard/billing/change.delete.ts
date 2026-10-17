import { undoChange } from '@lr/dashboard-core';

export default dashboardHandler('billing.write', async ({ actor, ctx }) => {
  await undoChange(ctx.deps.db, actor, ctx.billing);
  return { ok: true };
});
