import { and, count, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { tables } from '@lr/db';
import { idParam, pushSubscriptionBody } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { requireSession } from './auth.ts';

const MAX_SUBSCRIPTIONS = 10;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The worker POSTs to these URLs, so they are restricted: https always; plain http only for loopback hosts and only
 * when `allowLoopback` is set (local tests, never production).
 */
export function endpointAllowed(endpoint: string, allowLoopback: boolean): boolean {
  const url = new URL(endpoint);
  if (url.protocol === 'https:') return true;
  return allowLoopback && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

export function pushRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    const auth = requireSession(deps);

    r.get('/v1/push/vapid-public-key', async () => ({ publicKey: deps.vapidPublicKey ?? null }));

    r.post('/v1/me/push-subscriptions', { preHandler: auth, schema: { body: pushSubscriptionBody } }, async (req, reply) => {
      const userId = req.session!.userId;
      const { endpoint, keys } = req.body;
      if (!endpointAllowed(endpoint, deps.allowLoopbackPush ?? false)) return reply.code(422).send({ error: 'invalid_endpoint' });

      const [others] = await deps.db
        .select({ n: count() })
        .from(tables.pushSubscriptions)
        .where(and(eq(tables.pushSubscriptions.userId, userId), ne(tables.pushSubscriptions.endpoint, endpoint)));
      if ((others?.n ?? 0) >= MAX_SUBSCRIPTIONS) return reply.code(409).send({ error: 'too_many_subscriptions' });

      const userAgent = (req.headers['user-agent'] ?? '').slice(0, 200) || null;
      const [existing] = await deps.db.select({ id: tables.pushSubscriptions.id }).from(tables.pushSubscriptions).where(eq(tables.pushSubscriptions.endpoint, endpoint));
      // the same browser can sign in as another account: the endpoint moves to the latest user
      if (existing) {
        await deps.db
          .update(tables.pushSubscriptions)
          .set({ userId, p256dh: keys.p256dh, auth: keys.auth, userAgent, lastSeenAt: new Date() })
          .where(eq(tables.pushSubscriptions.id, existing.id));
        return reply.code(200).send({ id: existing.id });
      }
      const [created] = await deps.db
        .insert(tables.pushSubscriptions)
        .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent })
        .onConflictDoNothing()
        .returning({ id: tables.pushSubscriptions.id });
      if (!created) return reply.code(409).send({ error: 'conflict' });
      return reply.code(201).send({ id: created.id });
    });

    r.delete('/v1/me/push-subscriptions/:id', { preHandler: auth, schema: { params: idParam } }, async (req, reply) => {
      const removed = await deps.db
        .delete(tables.pushSubscriptions)
        .where(and(eq(tables.pushSubscriptions.id, req.params.id), eq(tables.pushSubscriptions.userId, req.session!.userId)))
        .returning({ id: tables.pushSubscriptions.id });
      if (removed.length === 0) return reply.code(404).send({ error: 'not_found' });
      return reply.code(204).send();
    });
  };
}
