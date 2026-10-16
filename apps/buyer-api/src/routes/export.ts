import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tables } from '@lr/db';
import type { AppDeps } from '../context.ts';
import { requireSession } from './auth.ts';

/** GDPR export: everything the platform holds about the user, as one JSON document. Credentials and keys are excluded. */
export function exportRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    app.get('/v1/me/export', { preHandler: requireSession(deps) }, async (req, reply) => {
      const userId = req.session!.userId;
      const [user] = await deps.db
        .select({ id: tables.users.id, email: tables.users.email, displayName: tables.users.displayName, locale: tables.users.locale, createdAt: tables.users.createdAt })
        .from(tables.users)
        .where(eq(tables.users.id, userId));
      const consents = await deps.db
        .select({ purpose: tables.consents.purpose, granted: tables.consents.granted, policyVersion: tables.consents.policyVersion, changedAt: tables.consents.changedAt })
        .from(tables.consents)
        .where(eq(tables.consents.userId, userId))
        .orderBy(asc(tables.consents.id));
      const pushSubscriptions = await deps.db
        .select({ id: tables.pushSubscriptions.id, endpoint: tables.pushSubscriptions.endpoint, userAgent: tables.pushSubscriptions.userAgent, createdAt: tables.pushSubscriptions.createdAt })
        .from(tables.pushSubscriptions)
        .where(eq(tables.pushSubscriptions.userId, userId));
      const claims = await deps.db
        .select({ receiptId: tables.claims.receiptId, source: tables.claims.source, claimedAt: tables.claims.claimedAt })
        .from(tables.claims)
        .where(eq(tables.claims.userId, userId))
        .orderBy(asc(tables.claims.claimedAt));
      const versions = claims.length
        ? await deps.db
            .select({ receiptId: tables.receiptVersions.receiptId, version: tables.receiptVersions.version, state: tables.receiptVersions.state, receipt: tables.receiptVersions.payload })
            .from(tables.receiptVersions)
            .where(inArray(tables.receiptVersions.receiptId, claims.map((c) => c.receiptId)))
            .orderBy(asc(tables.receiptVersions.receiptId), asc(tables.receiptVersions.version))
        : [];
      const uploads = await deps.db
        .select({
          id: tables.uploads.id,
          status: tables.uploads.status,
          contentType: tables.uploads.contentType,
          extracted: tables.uploads.extracted,
          matchedReceiptId: tables.uploads.matchedReceiptId,
          createdAt: tables.uploads.createdAt,
        })
        .from(tables.uploads)
        .where(eq(tables.uploads.userId, userId))
        .orderBy(asc(tables.uploads.createdAt));

      reply.header('content-disposition', 'attachment; filename="receipts-export.json"');
      return {
        exportedAt: new Date().toISOString(),
        user,
        consents,
        pushSubscriptions,
        receipts: claims.map((c) => ({ ...c, versions: versions.filter((v) => v.receiptId === c.receiptId).map(({ receiptId: _r, ...v }) => v) })),
        uploads,
      };
    });
  };
}
