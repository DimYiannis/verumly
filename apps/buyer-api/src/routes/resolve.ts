import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { resolveBody } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { checkSecret, claimedBy, isFinal, loadVersions, toPreview } from '../receipts.ts';

export function resolveRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    // One limiter shared by both public routes: v2 §10 says 30 requests/min per IP. Giving each route its own
    // `config.rateLimit` would create a separate counter per route (60/min per IP in total).
    const limit = app.createRateLimit({ max: deps.resolveRatePerMinute ?? 30, timeWindow: '1 minute' });
    r.addHook('onRequest', async (req, reply) => {
      const res = await limit(req);
      if (!res.isAllowed && res.isExceeded) {
        return reply.code(429).header('retry-after', res.ttlInSeconds).send({ error: 'too_many_requests' });
      }
    });

    r.post('/v1/resolve/secret', { schema: { body: resolveBody } }, async (req, reply) => {
      const res = await checkSecret(deps.db, req.body.receiptId, req.body.secret);
      if (res.kind === 'pending') return { status: 'pending' as const };
      if (res.kind === 'limited') return reply.code(429).send({ error: 'too_many_requests' });
      if (res.kind === 'bad') return reply.code(404).send({ error: 'not_found' });
      const claimed = (await claimedBy(deps.db, res.receipt.id)) !== undefined;
      return { status: 'ok' as const, preview: toPreview(res.receipt, claimed) };
    });

    r.post('/v1/resolve/view', { schema: { body: resolveBody } }, async (req, reply) => {
      const res = await checkSecret(deps.db, req.body.receiptId, req.body.secret);
      if (res.kind === 'pending') return { status: 'pending' as const };
      if (res.kind === 'limited') return reply.code(429).send({ error: 'too_many_requests' });
      if (res.kind === 'bad') return reply.code(404).send({ error: 'not_found' });
      const claimed = (await claimedBy(deps.db, res.receipt.id)) !== undefined;
      return {
        status: 'ok' as const,
        preview: toPreview(res.receipt, claimed),
        receipt: res.receipt.crf,
        final: isFinal(res.receipt),
        template: res.receipt.template,
        versions: await loadVersions(deps.db, res.receipt.id),
      };
    });
  };
}
