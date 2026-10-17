import { z } from 'zod';
import { deleteReportView } from '@lr/dashboard-core';

export default dashboardHandler('reports.read', async ({ event, actor, ctx }) => {
  const id = z.uuid().parse(getRouterParam(event, 'id'));
  await deleteReportView(ctx.deps.db, actor, id);
  return { ok: true };
});
