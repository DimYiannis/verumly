import { getReceiptWithVersions } from '@lr/dashboard-core';

export default dashboardHandler('archive.read', async ({ event, actor, ctx }) => {
  const r = await getReceiptWithVersions(ctx.deps.db, actor.orgId, getRouterParam(event, 'id') ?? '');
  if (!r) throw createError({ statusCode: 404, statusMessage: 'receipt not found' });
  return r;
});
