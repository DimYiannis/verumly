import { z } from 'zod';
import { updateUserRole } from '@lr/dashboard-core';

const body = z.object({ role: z.string() }).strict();

export default dashboardHandler('users.write', async ({ event, actor, ctx }) =>
  updateUserRole(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '', body.parse(await readBody(event)).role),
);
