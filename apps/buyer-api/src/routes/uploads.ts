import { and, count, desc, eq, gt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { findMatchingReceipt, orgIdsByIdentifiers, QUEUES, tables, type ExtractUploadJob } from '@lr/db';
import { createUploadBody, idParam, MAX_UPLOAD_BYTES, uploadExtracted, uploadPatchBody, type UploadExtracted } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { claimedBy, loadReceipt } from '../receipts.ts';
import { applyCorrections, ownUpload, readExtracted, uploadView } from '../uploads.ts';
import { requireSession } from './auth.ts';

const MAX_UPLOADS_PER_HOUR = 50;

export function uploadRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', requireSession(deps));

    r.post('/v1/me/uploads', { schema: { body: createUploadBody } }, async (req, reply) => {
      if (!deps.s3) return reply.code(503).send({ error: 'storage_unavailable' });
      const userId = req.session!.userId;
      const [recent] = await deps.db
        .select({ n: count() })
        .from(tables.uploads)
        .where(and(eq(tables.uploads.userId, userId), gt(tables.uploads.createdAt, new Date(Date.now() - 3_600_000))));
      if ((recent?.n ?? 0) >= MAX_UPLOADS_PER_HOUR) return reply.code(429).send({ error: 'too_many_requests' });

      const uploadId = crypto.randomUUID();
      const key = `uploads/${userId}/${uploadId}`;
      await deps.db.insert(tables.uploads).values({ id: uploadId, userId, s3Key: key, contentType: req.body.contentType });
      // the size is part of the signature: S3 rejects a body of any other length
      const uploadUrl = await deps.s3.presignPut(key, req.body.contentType, req.body.size);
      return reply.code(201).send({ uploadId, uploadUrl, headers: { 'content-type': req.body.contentType } });
    });

    r.post('/v1/me/uploads/:id/complete', { schema: { params: idParam } }, async (req, reply) => {
      if (!deps.s3) return reply.code(503).send({ error: 'storage_unavailable' });
      const userId = req.session!.userId;
      const upload = await ownUpload(deps.db, userId, req.params.id);
      if (!upload) return reply.code(404).send({ error: 'not_found' });
      if (upload.status !== 'pending_upload') return reply.code(202).send({ uploadId: upload.id, status: upload.status });

      const head = await deps.s3.head(upload.s3Key);
      if (!head) return reply.code(409).send({ error: 'not_uploaded' });
      if (head.size > MAX_UPLOAD_BYTES || head.size === 0) {
        await deps.s3.remove(upload.s3Key);
        const extracted: UploadExtracted = { parsed: null, failures: ['bad_size'], modelRevision: null, corrected: false };
        await deps.db.update(tables.uploads).set({ status: 'failed', extracted }).where(eq(tables.uploads.id, upload.id));
        return reply.code(413).send({ error: 'bad_size' });
      }
      const moved = await deps.db
        .update(tables.uploads)
        .set({ status: 'processing' })
        .where(and(eq(tables.uploads.id, upload.id), eq(tables.uploads.status, 'pending_upload')))
        .returning({ id: tables.uploads.id });
      if (moved.length === 1) {
        const job: ExtractUploadJob = { uploadId: upload.id };
        try {
          await deps.boss.send(QUEUES.extractUpload, job, { singletonKey: upload.id, retryLimit: 3, retryDelay: 5, retryBackoff: true });
        } catch (e) {
          await deps.db.update(tables.uploads).set({ status: 'pending_upload' }).where(eq(tables.uploads.id, upload.id));
          throw e;
        }
      }
      return reply.code(202).send({ uploadId: upload.id, status: 'processing' });
    });

    r.get('/v1/me/uploads', async (req) => {
      const userId = req.session!.userId;
      const rows = await deps.db.select().from(tables.uploads).where(eq(tables.uploads.userId, userId)).orderBy(desc(tables.uploads.createdAt)).limit(50);
      return { items: await Promise.all(rows.map((u) => uploadView(deps.db, userId, u))) };
    });

    r.get('/v1/me/uploads/:id', { schema: { params: idParam } }, async (req, reply) => {
      const userId = req.session!.userId;
      const upload = await ownUpload(deps.db, userId, req.params.id);
      if (!upload) return reply.code(404).send({ error: 'not_found' });
      return uploadView(deps.db, userId, upload);
    });

    r.patch('/v1/me/uploads/:id', { schema: { params: idParam, body: uploadPatchBody } }, async (req, reply) => {
      const userId = req.session!.userId;
      const upload = await ownUpload(deps.db, userId, req.params.id);
      if (!upload) return reply.code(404).send({ error: 'not_found' });
      const extracted = readExtracted(upload);
      if (upload.status !== 'needs_review' || !extracted?.parsed) return reply.code(409).send({ error: 'not_reviewable' });

      const parsed = applyCorrections(extracted.parsed, req.body);
      // corrected total/time can make an official receipt match that did not before
      let matchedReceiptId = upload.matchedReceiptId;
      if (!matchedReceiptId && parsed.gross !== null && parsed.printedAtUtc !== null) {
        const orgIds = await orgIdsByIdentifiers(deps.db, parsed.merchant);
        matchedReceiptId = await findMatchingReceipt(deps.db, orgIds, parsed.gross, parsed.printedAtUtc);
      }
      const next: UploadExtracted = uploadExtracted.parse({ parsed, failures: parsed.failures, modelRevision: extracted.modelRevision, corrected: true });
      const [updated] = await deps.db
        .update(tables.uploads)
        .set({ status: parsed.status, extracted: next, matchedReceiptId })
        .where(and(eq(tables.uploads.id, upload.id), eq(tables.uploads.status, 'needs_review')))
        .returning();
      if (!updated) return reply.code(409).send({ error: 'not_reviewable' });
      return uploadView(deps.db, userId, updated);
    });

    r.post('/v1/me/uploads/:id/accept-match', { schema: { params: idParam } }, async (req, reply) => {
      const userId = req.session!.userId;
      const upload = await ownUpload(deps.db, userId, req.params.id);
      if (!upload) return reply.code(404).send({ error: 'not_found' });
      if (upload.status === 'replaced' && upload.matchedReceiptId) return { receiptId: upload.matchedReceiptId };
      if (!upload.matchedReceiptId || (upload.status !== 'done' && upload.status !== 'needs_review')) return reply.code(409).send({ error: 'no_match' });

      const receipt = await loadReceipt(deps.db, upload.matchedReceiptId);
      if (!receipt) return reply.code(404).send({ error: 'not_found' });
      const owner = await claimedBy(deps.db, receipt.id);
      if (owner && owner !== userId) return reply.code(409).send({ error: 'already_claimed' });
      if (!owner) {
        if (receipt.claimableUntil.getTime() < Date.now()) return reply.code(410).send({ error: 'claim_expired' });
        const inserted = await deps.db
          .insert(tables.claims)
          .values({ receiptId: receipt.id, userId, source: 'photo_match' })
          .onConflictDoNothing()
          .returning({ receiptId: tables.claims.receiptId });
        if (inserted.length === 0 && (await claimedBy(deps.db, receipt.id)) !== userId) {
          await deps.db.insert(tables.auditLog).values({ event: 'claim_conflict', receiptId: receipt.id, requestId: req.id });
          return reply.code(409).send({ error: 'already_claimed' });
        }
        if (inserted.length === 1) await deps.db.insert(tables.auditLog).values({ event: 'claim', receiptId: receipt.id, detail: { source: 'photo_match' }, requestId: req.id });
      }
      await deps.db.update(tables.uploads).set({ status: 'replaced' }).where(eq(tables.uploads.id, upload.id));
      return { receiptId: receipt.id };
    });
  };
}
