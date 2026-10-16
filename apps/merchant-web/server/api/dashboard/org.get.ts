import { getOrganization } from '@lr/dashboard-core';

export default dashboardHandler('org.read', ({ actor, ctx }) => getOrganization(ctx.deps.db, actor));
