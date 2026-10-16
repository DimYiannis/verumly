import { deleteUser } from '@lr/dashboard-core';

export default dashboardHandler('users.write', async ({ event, actor, ctx }) => {
  await deleteUser(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '');
  return { ok: true };
});
