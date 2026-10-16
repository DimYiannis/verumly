import { z } from 'zod';
import { getReceiptWithVersions, receiptPdf } from '@lr/dashboard-core';

const query = z.object({ version: z.coerce.number().int().min(1).optional() });

/** PDF of one version (default: the current one). */
export default dashboardHandler('archive.read', async ({ event, actor, ctx }) => {
  const id = getRouterParam(event, 'id') ?? '';
  const r = await getReceiptWithVersions(ctx.deps.db, actor.orgId, id);
  const { version } = query.parse(getQuery(event));
  const v = r?.versions.find((x) => x.version === (version ?? r.currentVersion));
  if (!r || !v) throw createError({ statusCode: 404, statusMessage: 'receipt not found' });
  const pdf = await receiptPdf(v.crf);
  setResponseHeaders(event, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="receipt-${id.slice(0, 8)}-v${v.version}.pdf"` });
  return Buffer.from(pdf);
});
