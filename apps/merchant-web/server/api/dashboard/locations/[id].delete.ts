import { deleteLocation } from '@lr/dashboard-core';

export default dashboardHandler('locations.write', async ({ event, actor, ctx }) => {
  await deleteLocation(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '');
  return { ok: true };
});
