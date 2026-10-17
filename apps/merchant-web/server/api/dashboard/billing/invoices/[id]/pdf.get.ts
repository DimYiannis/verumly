import { invoicePdf } from '@lr/dashboard-core';

export default dashboardHandler('billing.read', async ({ event, actor, ctx }) => {
  const { number, pdf } = await invoicePdf(ctx.deps.db, actor, getRouterParam(event, 'id') ?? '');
  setResponseHeaders(event, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="invoice-${number}.pdf"` });
  return Buffer.from(pdf);
});
