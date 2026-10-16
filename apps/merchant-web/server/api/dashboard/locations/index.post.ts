import { createLocation } from '@lr/dashboard-core';

export default dashboardHandler('locations.write', async ({ event, actor, ctx }) => createLocation(ctx.deps.db, actor, await readBody(event)));
