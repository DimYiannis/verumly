import { listUsers } from '@lr/dashboard-core';

export default dashboardHandler('users.read', ({ actor, ctx }) => listUsers(ctx.deps.db, actor));
