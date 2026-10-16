import { listLocations } from '@lr/dashboard-core';

export default dashboardHandler('locations.read', ({ actor, ctx }) => listLocations(ctx.deps.db, actor));
