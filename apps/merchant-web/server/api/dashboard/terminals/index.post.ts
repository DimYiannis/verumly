import { createTerminal } from '@lr/dashboard-core';

/** Registers the public key and returns the API key — the only time it is ever shown. */
export default dashboardHandler('terminals.write', async ({ event, actor, ctx }) => createTerminal(ctx.deps.db, actor, await readBody(event)));
