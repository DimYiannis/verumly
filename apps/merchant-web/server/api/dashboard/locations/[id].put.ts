import { updateLocation } from '@lr/dashboard-core';

export default dashboardHandler('locations.write', async ({ event, actor, ctx }) => updateLocation(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '', await readBody(event)));
