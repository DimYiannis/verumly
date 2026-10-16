import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tables } from '@lr/db';
import type { AppDeps } from '../context.ts';
import { requireSession } from './auth.ts';

/**
 * Soft-delete: the account can no longer sign in, every session and push subscription is revoked at once, and the
 * `retention` worker job hard-deletes the user, claims and uploads 30 days later. The audit entry carries no user id.
 */
export function accountRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.delete('/v1/me', { preHandler: requireSession(deps) }, async (req, reply) => {
      const userId = req.session!.userId;
      await deps.db.transaction(async (tx) => {
        await tx.update(tables.users).set({ deletedAt: new Date() }).where(eq(tables.users.id, userId));
        await tx.delete(tables.sessions).where(eq(tables.sessions.userId, userId));
        await tx.delete(tables.pushSubscriptions).where(eq(tables.pushSubscriptions.userId, userId));
        await tx.insert(tables.auditLog).values({ event: 'account_deleted', requestId: req.id });
      });
      return reply.code(204).send();
    });
  };
}
