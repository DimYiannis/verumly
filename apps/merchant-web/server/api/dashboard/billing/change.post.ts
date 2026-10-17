import { scheduleChange } from '@lr/dashboard-core';

/** Schedules `{ plan, interval }` for the next renewal (no proration). */
export default dashboardHandler('billing.write', async ({ event, actor, ctx }) => {
  await scheduleChange(ctx.deps.db, actor, await readBody(event), ctx.billing);
  return { ok: true };
});
