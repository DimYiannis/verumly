import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { uuidV7String } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { renderReceiptPdf } from '@lr/receipt-pdf';
import { claimedBy, isFinal, loadReceipt } from '../receipts.ts';
import { requireSession } from './auth.ts';

export function pdfRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.get('/v1/me/receipts/:id/pdf', { preHandler: requireSession(deps), schema: { params: z.object({ id: uuidV7String }) } }, async (req, reply) => {
      // same answer for "not yours" and "does not exist"
      if ((await claimedBy(deps.db, req.params.id)) !== req.session!.userId) return reply.code(404).send({ error: 'not_found' });
      const receipt = await loadReceipt(deps.db, req.params.id);
      if (!receipt) return reply.code(404).send({ error: 'not_found' });
      const pdf = await renderReceiptPdf(receipt.crf, receipt.template, { final: isFinal(receipt) });
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="receipt-${receipt.id.slice(0, 8)}.pdf"`)
        .send(Buffer.from(pdf));
    });
  };
}
