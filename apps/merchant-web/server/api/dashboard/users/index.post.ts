import { createUser } from '@lr/dashboard-core';

export default dashboardHandler('users.write', async ({ event, actor, ctx }) => createUser(ctx.deps.db, actor, await readBody(event)));
