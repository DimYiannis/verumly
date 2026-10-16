import { listTerminals } from '@lr/dashboard-core';

export default dashboardHandler('terminals.read', ({ actor, ctx }) => listTerminals(ctx.deps.db, actor));
