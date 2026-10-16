import { listExports } from '@lr/dashboard-core';

export default dashboardHandler('exports.read', ({ actor, ctx }) => listExports(ctx.deps.db, actor, ctx.s3));
