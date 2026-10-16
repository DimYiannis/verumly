import { z } from 'zod';
import { searchArchive } from '@lr/dashboard-core';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  from: day.optional(),
  to: day.optional(),
  state: z.enum(['open', 'presented', 'paid', 'fiscalised', 'void']).optional(),
  q: z.string().trim().max(80).optional(),
  /** exact gross in euro cents */
  amount: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export default dashboardHandler('archive.read', ({ event, actor, ctx }) => {
  const f = query.parse(getQuery(event));
  return searchArchive(ctx.deps.db, actor.orgId, f);
});
