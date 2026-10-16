import { revokeTerminal } from '@lr/dashboard-core';

export default dashboardHandler('terminals.write', async ({ event, actor, ctx }) => {
  await revokeTerminal(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '');
  return { ok: true };
});
