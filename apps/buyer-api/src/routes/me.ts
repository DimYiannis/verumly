import { and, desc, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { tables } from '@lr/db';
import { isFinalState } from '@lr/receipt-nl';
import { claimBody, uuidV7String, type Crf } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { checkSecret, claimedBy, isFinal, loadReceipt, loadVersions } from '../receipts.ts';
import { requireSession } from './auth.ts';

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
}
function decodeCursor(c: string): { at: Date; id: string } | undefined {
  try {
    const v: unknown = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return { at: new Date(v[0]), id: v[1] };
  } catch {
    /* fall through */
  }
  return undefined;
}

const listQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  q: z.string().max(100).optional(),
  state: z.enum(['presented', 'paid', 'void']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: z.string().max(40).optional(),
  merchant: z.string().max(100).optional(),
});

export function meRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', requireSession(deps));

    r.post('/v1/me/claims', { schema: { body: claimBody } }, async (req, reply) => {
      const userId = req.session!.userId;
      const res = await checkSecret(deps.db, req.body.receiptId, req.body.secret);
      if (res.kind === 'pending') return reply.code(404).send({ error: 'not_found' });
      if (res.kind === 'limited') return reply.code(429).send({ error: 'too_many_requests' });
      if (res.kind === 'bad') return reply.code(404).send({ error: 'not_found' });

      const owner = await claimedBy(deps.db, res.receipt.id);
      if (owner === userId) return reply.code(200).send({ receiptId: res.receipt.id, status: 'already_yours' });
      if (owner) return reply.code(409).send({ error: 'already_claimed' });
      if (res.receipt.claimableUntil.getTime() < Date.now()) return reply.code(410).send({ error: 'claim_expired' });

      // `receipt_id` is the primary key: exactly one concurrent claimer wins the insert
      const inserted = await deps.db
        .insert(tables.claims)
        .values({ receiptId: res.receipt.id, userId, source: req.body.source })
        .onConflictDoNothing()
        .returning({ receiptId: tables.claims.receiptId });
      if (inserted.length === 0) {
        const now = await claimedBy(deps.db, res.receipt.id);
        if (now === userId) return reply.code(200).send({ receiptId: res.receipt.id, status: 'already_yours' });
        await deps.db.insert(tables.auditLog).values({ event: 'claim_conflict', receiptId: res.receipt.id, requestId: req.id });
        return reply.code(409).send({ error: 'already_claimed' });
      }
      await deps.db.insert(tables.auditLog).values({ event: 'claim', receiptId: res.receipt.id, requestId: req.id });
      return reply.code(201).send({ receiptId: res.receipt.id, status: 'claimed' });
    });

    r.get('/v1/me/receipts', { schema: { querystring: listQuery } }, async (req) => {
      const userId = req.session!.userId;
      const q = req.query;
      const c = q.cursor ? decodeCursor(q.cursor) : undefined;
      const conds = [eq(tables.claims.userId, userId)];
      if (c) {
        conds.push(
          or(
            lt(tables.receipts.createdOnTerminalAt, c.at),
            and(eq(tables.receipts.createdOnTerminalAt, c.at), lt(tables.receipts.id, c.id)),
          )!,
        );
      }
      // `paid` is what the wallet calls issued: in countries with a fiscal step that is `paid` or `fiscalised`
      if (q.state === 'paid') conds.push(inArray(tables.receipts.state, ['paid', 'fiscalised']));
      else if (q.state) conds.push(eq(tables.receipts.state, q.state));
      if (q.from) conds.push(gte(tables.receipts.createdOnTerminalAt, new Date(`${q.from}T00:00:00Z`)));
      if (q.to) conds.push(lte(tables.receipts.createdOnTerminalAt, new Date(`${q.to}T23:59:59.999Z`)));
      if (q.merchant) conds.push(sql`${tables.receiptVersions.payload}->'merchant'->>'name' ilike ${`%${q.merchant}%`}`);
      if (q.q) {
        const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
        conds.push(
          or(
            sql`${tables.receiptVersions.payload}->'merchant'->>'name' ilike ${like}`,
            sql`exists (select 1 from merchant.receipt_lines l where l.receipt_id = ${tables.receipts.id} and l.description ilike ${like})`,
          )!,
        );
      }
      if (q.category) {
        conds.push(sql`exists (select 1 from merchant.receipt_lines l where l.receipt_id = ${tables.receipts.id} and l.category = ${q.category})`);
      }
      const rows = await deps.db
        .select({
          id: tables.receipts.id,
          state: tables.receipts.state,
          currentVersion: tables.receipts.currentVersion,
          totalMinor: tables.receipts.totalMinor,
          currency: tables.receipts.currency,
          createdAt: tables.receipts.createdOnTerminalAt,
          claimedAt: tables.claims.claimedAt,
          source: tables.claims.source,
          merchantName: sql<string>`${tables.receiptVersions.payload}->'merchant'->>'name'`,
          country: sql<string>`${tables.receiptVersions.payload}->'fiscal'->>'country'`,
          locationName: tables.locations.name,
        })
        .from(tables.claims)
        .innerJoin(tables.receipts, eq(tables.receipts.id, tables.claims.receiptId))
        .innerJoin(tables.locations, eq(tables.locations.id, tables.receipts.locationId))
        .innerJoin(
          tables.receiptVersions,
          and(eq(tables.receiptVersions.receiptId, tables.receipts.id), eq(tables.receiptVersions.version, tables.receipts.currentVersion)),
        )
        .where(and(...conds))
        .orderBy(desc(tables.receipts.createdOnTerminalAt), desc(tables.receipts.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((x) => ({
          receiptId: x.id,
          merchantName: x.merchantName,
          locationName: x.locationName,
          total: x.totalMinor,
          currency: x.currency,
          createdAt: x.createdAt.toISOString(),
          claimedAt: x.claimedAt.toISOString(),
          source: x.source,
          state: x.state,
          version: x.currentVersion,
          final: isFinalState(x.state as Crf['state'], x.country ?? 'NL'),
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.createdAt, last.id) : null,
      };
    });

    r.get('/v1/me/receipts/:id', { schema: { params: z.object({ id: uuidV7String }) } }, async (req, reply) => {
      const owner = await claimedBy(deps.db, req.params.id);
      if (owner !== req.session!.userId) return reply.code(404).send({ error: 'not_found' });
      const receipt = await loadReceipt(deps.db, req.params.id);
      if (!receipt) return reply.code(404).send({ error: 'not_found' });
      return { receipt: receipt.crf, final: isFinal(receipt), template: receipt.template, versions: await loadVersions(deps.db, receipt.id) };
    });
  };
}
