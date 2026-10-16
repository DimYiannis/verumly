import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { loggerOptions } from '@lr/config';
import { sha256Hex, verifyBytes } from '@lr/crypto';
import { QUEUES, tables, withOrg, type Db, type NotifyVersionJob, type PgBoss } from '@lr/db';
import { addVersionBody, batchBody, createReceiptBody, uuidV7String } from '@lr/schema';
import { ingestVersion, type IngestOutcome, type TerminalCtx } from './ingest.ts';

export interface AppDeps {
  db: Db;
  boss: Pick<PgBoss, 'send'>;
  claimWindowDays: number;
  logLevel?: string;
  /** test hook: capture log lines (privacy canary) */
  logStream?: NodeJS.WritableStream;
}

declare module 'fastify' {
  interface FastifyRequest {
    terminal?: TerminalCtx;
    rawBody?: string;
  }
}

const idemHeader = z.object({ 'idempotency-key': z.string().min(8).max(200) });

async function enqueueNotify(boss: AppDeps['boss'], out: Extract<IngestOutcome, { ok: true }>) {
  if (!out.notify) return;
  const data: NotifyVersionJob = { receiptId: out.receiptId, version: out.version, state: out.state };
  await boss.send(QUEUES.notifyVersion, data, { singletonKey: `${out.receiptId}:${out.version}` });
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { ...loggerOptions(deps.logLevel ?? 'info'), ...(deps.logStream ? { stream: deps.logStream } : {}) },
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(helmet);

  // keep the raw body so X-Signature can be verified over the exact bytes the terminal signed
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = typeof body === 'string' ? body : body.toString('utf8');
    try {
      done(null, req.rawBody.length ? JSON.parse(req.rawBody) : undefined);
    } catch {
      done(Object.assign(new Error('invalid json'), { statusCode: 400 }), undefined);
    }
  });

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    const m = /^Bearer (\S{20,200})$/.exec(req.headers.authorization ?? '');
    const terminalHeader = req.headers['x-terminal-id'];
    if (!m || typeof terminalHeader !== 'string') return reply.code(401).send({ error: 'unauthorized' });
    const hash = sha256Hex(m[1]!);
    const rows = await deps.db.execute<{
      id: string;
      org_id: string;
      location_id: string;
      signing_public_key: string;
      revoked_at: string | null;
    }>(sql`select * from merchant.authenticate_terminal(${hash})`);
    const t = rows.rows[0];
    if (!t || t.id !== terminalHeader || t.revoked_at) return reply.code(401).send({ error: 'unauthorized' });

    if (req.method === 'POST') {
      const sig = req.headers['x-signature'];
      if (typeof sig !== 'string' || !req.rawBody || !verifyBytes(t.signing_public_key, new TextEncoder().encode(req.rawBody), sig)) {
        await deps.db.insert(tables.auditLog).values({
          event: 'failed_signature',
          orgId: t.org_id,
          terminalId: t.id,
          detail: { scope: 'request' },
          requestId: req.id,
        });
        return reply.code(401).send({ error: 'bad_signature' });
      }
    }
    const [org] = await withOrg(deps.db, t.org_id, (tx) =>
      tx.select({ country: tables.organizations.country }).from(tables.organizations).where(eq(tables.organizations.id, t.org_id)),
    );
    req.terminal = { terminalId: t.id, orgId: t.org_id, locationId: t.location_id, publicKey: t.signing_public_key, country: org?.country ?? 'NL' };
  };

  app.get('/healthz', async () => ({ ok: true }));

  app.register(async (api) => {
    const r = api.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', authenticate);

    const send = (reply: FastifyReply, out: IngestOutcome) => {
      if (!out.ok) return reply.code(out.httpStatus).send({ error: out.error, issues: out.issues, detail: out.detail });
      return reply.code(out.status === 'created' ? 201 : 200).send({ receiptId: out.receiptId, version: out.version, status: out.status });
    };

    r.post('/v1/receipts', { schema: { headers: idemHeader, body: createReceiptBody } }, async (req, reply) => {
      const out = await ingestVersion(deps.db, req.terminal!, {
        idempotencyKey: req.headers['idempotency-key'],
        body: req.body,
        create: true,
        claimWindowDays: deps.claimWindowDays,
        requestId: req.id,
      });
      if (out.ok) await enqueueNotify(deps.boss, out);
      return send(reply, out);
    });

    r.post(
      '/v1/receipts/:id/versions',
      { schema: { headers: idemHeader, params: z.object({ id: uuidV7String }), body: addVersionBody } },
      async (req, reply) => {
        const out = await ingestVersion(deps.db, req.terminal!, {
          idempotencyKey: req.headers['idempotency-key'],
          body: req.body,
          create: false,
          pathReceiptId: req.params.id,
          claimWindowDays: deps.claimWindowDays,
          requestId: req.id,
        });
        if (out.ok) await enqueueNotify(deps.boss, out);
        return send(reply, out);
      },
    );

    // POST /v1/receipts:batch — Fastify routes ':' as a param marker, so escape it with '::'
    r.post('/v1/receipts::batch', { schema: { body: batchBody } }, async (req, reply) => {
      const results: Array<Record<string, unknown>> = [];
      for (const item of req.body.items) {
        const body = item.body;
        const create = 'claimSecretHash' in body;
        const out = await ingestVersion(deps.db, req.terminal!, {
          idempotencyKey: item.idempotencyKey,
          body,
          create,
          claimWindowDays: deps.claimWindowDays,
          requestId: req.id,
        });
        if (out.ok) {
          await enqueueNotify(deps.boss, out);
          results.push({ idempotencyKey: item.idempotencyKey, status: out.status, receiptId: out.receiptId, version: out.version });
        } else {
          results.push({ idempotencyKey: item.idempotencyKey, status: 'error', httpStatus: out.httpStatus, error: out.error, detail: out.detail });
        }
      }
      return reply.code(200).send({ results });
    });

    r.get('/v1/receipts/:id', { schema: { params: z.object({ id: uuidV7String }) } }, async (req, reply) => {
      const t = req.terminal!;
      const found = await withOrg(deps.db, t.orgId, async (tx) => {
        const [receipt] = await tx
          .select({
            id: tables.receipts.id,
            state: tables.receipts.state,
            currentVersion: tables.receipts.currentVersion,
            totalMinor: tables.receipts.totalMinor,
            currency: tables.receipts.currency,
            receivedAt: tables.receipts.receivedAt,
            claimableUntil: tables.receipts.claimableUntil,
          })
          .from(tables.receipts)
          .where(eq(tables.receipts.id, req.params.id));
        if (!receipt) return null;
        const versions = await tx
          .select({
            version: tables.receiptVersions.version,
            state: tables.receiptVersions.state,
            payload: tables.receiptVersions.payload,
            signature: tables.receiptVersions.signature,
          })
          .from(tables.receiptVersions)
          .where(and(eq(tables.receiptVersions.receiptId, req.params.id)))
          .orderBy(asc(tables.receiptVersions.version));
        return { receipt, versions };
      });
      if (!found) return reply.code(404).send({ error: 'not_found' });
      return found;
    });

    r.get('/v1/terminals/me', async (req) => ({
      terminalId: req.terminal!.terminalId,
      locationId: req.terminal!.locationId,
      orgId: req.terminal!.orgId,
      serverTime: new Date().toISOString(),
      claimWindowDays: deps.claimWindowDays,
    }));
  });

  return app;
}
