import { z } from 'zod';
import { salesReport } from '@lr/dashboard-core';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({ from: day, to: day, granularity: z.enum(['day', 'month']).default('day'), locationId: z.uuid().optional() });

export default dashboardHandler('reports.read', ({ event, actor, ctx }) => salesReport(ctx.deps.db, actor, query.parse(getQuery(event))));
