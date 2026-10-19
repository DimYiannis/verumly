import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateToken } from '@lr/crypto';
import { tables, type Db } from '@lr/db';
import { settleBody, splitCreateBody, uuidString } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { mainCurrency } from '../currency.ts';
import { loadReceipt } from '../receipts.ts';
import { areFriends, hasClaimed, publicUsers, userOrGhost } from '../social.ts';
import { computeShares, decodeLineRefs, encodeLineRefs, payable, SplitError } from '../split-math.ts';
import { requireSession } from './auth.ts';

const INVITE_TTL_MS = 30 * 86_400_000;
const idParam = z.object({ id: uuidString });
const shareParam = z.object({ id: uuidString, shareId: uuidString });

/** Splitting a saved receipt between friends and guests, and the balances that follow. No payments: shares are settled by hand. */
export function splitRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', requireSession(deps));
    const db = deps.db;

    /** The split as `viewer` sees it, or undefined when the viewer is neither the creator nor a participant. */
    async function detail(splitId: string, viewer: string) {
      const [split] = await db.select().from(tables.splits).where(eq(tables.splits.id, splitId));
      if (!split) return undefined;
      const shares = await db.select().from(tables.splitShares).where(eq(tables.splitShares.splitId, split.id)).orderBy(tables.splitShares.createdAt);
      const involved = split.creatorId === viewer || shares.some((s) => s.userId === viewer);
      if (!involved) return undefined;
      const receipt = await loadReceipt(db, split.receiptId);
      if (!receipt) return undefined;
      const users = await publicUsers(db, [split.creatorId, ...shares.flatMap((s) => (s.userId ? [s.userId] : []))]);
      return {
        id: split.id,
        receiptId: split.receiptId,
        creator: userOrGhost(users, split.creatorId),
        creatorIsMe: split.creatorId === viewer,
        mode: split.mode as 'equal' | 'items' | 'custom',
        totalMinor: split.totalMinor,
        currency: split.currency,
        createdAt: split.createdAt.toISOString(),
        shares: shares.map((s) => ({
          id: s.id,
          who: s.userId ? userOrGhost(users, s.userId) : null,
          guestName: s.guestName,
          amountMinor: s.amountMinor,
          settled: s.settledAt !== null,
          settledAt: s.settledAt?.toISOString() ?? null,
          isMe: s.userId === viewer,
          ...decodeLineRefs(s.lineNos),
          // the code itself is only known when it is created (only its hash is stored): see the POST responses
          inviteCode: null as string | null,
        })),
        receipt: receipt.crf,
        template: receipt.template,
      };
    }

    r.post('/v1/me/splits', { schema: { body: splitCreateBody } }, async (req, reply) => {
      const me = req.session!.userId;
      const body = req.body;
      if (!(await hasClaimed(db, body.receiptId, me))) return reply.code(404).send({ error: 'not_found' });
      const receipt = await loadReceipt(db, body.receiptId);
      if (!receipt) return reply.code(404).send({ error: 'not_found' });
      if (receipt.state === 'void') return reply.code(409).send({ error: 'receipt_void' });

      const userIds = body.participants.flatMap((p) => (p.userId ? [p.userId] : []));
      if (new Set(userIds).size !== userIds.length || userIds.includes(me)) return reply.code(400).send({ error: 'duplicate_person' });
      for (const id of userIds) if (!(await areFriends(db, me, id))) return reply.code(403).send({ error: 'not_friends' });

      let computed;
      try {
        computed = computeShares(receipt.crf, body);
      } catch (e) {
        if (e instanceof SplitError) return reply.code(400).send({ error: e.code, message: e.message });
        throw e;
      }

      const codes = new Map<string, string>();
      const splitId = await db.transaction(async (tx) => {
        const [split] = await tx
          .insert(tables.splits)
          .values({ receiptId: body.receiptId, creatorId: me, mode: body.mode, totalMinor: payable(receipt.crf), currency: receipt.currency })
          .returning({ id: tables.splits.id });
        for (const c of computed) {
          const p = c.who === 'me' ? null : body.participants[Number(c.who.slice(1))]!;
          const [share] = await tx
            .insert(tables.splitShares)
            .values({
              splitId: split!.id,
              userId: c.who === 'me' ? me : (p!.userId ?? null),
              guestName: p?.guestName ?? null,
              amountMinor: c.amountMinor,
              lineNos: encodeLineRefs(c),
              // the creator paid the bill: their own share is settled from the start
              settledAt: c.who === 'me' ? new Date() : null,
            })
            .returning({ id: tables.splitShares.id });
          if (p && p.userId === null) {
            const { token, hash } = generateToken();
            await tx.insert(tables.invites).values({ codeHash: hash, inviterId: me, splitShareId: share!.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
            codes.set(share!.id, token);
          }
        }
        return split!.id;
      });

      const d = await detail(splitId, me);
      // guest invite codes are shown once, in this response
      const out = d && { ...d, shares: d.shares.map((s) => ({ ...s, inviteCode: codes.get(s.id) ?? null })) };
      return reply.code(201).send(out);
    });

    r.get('/v1/me/splits', async (req) => {
      const me = req.session!.userId;
      const mine = await db
        .select({ id: tables.splits.id })
        .from(tables.splits)
        .leftJoin(tables.splitShares, eq(tables.splitShares.splitId, tables.splits.id))
        .where(or(eq(tables.splits.creatorId, me), eq(tables.splitShares.userId, me)));
      const ids = [...new Set(mine.map((x) => x.id))];
      if (ids.length === 0) return { splits: [] };
      const splits = await db.select().from(tables.splits).where(inArray(tables.splits.id, ids)).orderBy(desc(tables.splits.createdAt)).limit(100);
      const shares = await db.select().from(tables.splitShares).where(inArray(tables.splitShares.splitId, splits.map((s) => s.id)));
      const users = await publicUsers(db, splits.map((s) => s.creatorId));
      const list = [];
      for (const s of splits) {
        const mineShare = shares.find((x) => x.splitId === s.id && x.userId === me);
        const others = shares.filter((x) => x.splitId === s.id && x.userId !== s.creatorId && x.settledAt === null);
        const receipt = await loadReceipt(db, s.receiptId);
        list.push({
          id: s.id,
          receiptId: s.receiptId,
          merchantName: receipt?.crf.merchant.name ?? '',
          createdAt: s.createdAt.toISOString(),
          totalMinor: s.totalMinor,
          creator: userOrGhost(users, s.creatorId),
          creatorIsMe: s.creatorId === me,
          myShareMinor: mineShare?.amountMinor ?? 0,
          openMinor: s.creatorId === me ? others.reduce((a, x) => a + x.amountMinor, 0) : mineShare && mineShare.settledAt === null ? mineShare.amountMinor : 0,
        });
      }
      return { splits: list };
    });

    r.get('/v1/me/splits/:id', { schema: { params: idParam } }, async (req, reply) => {
      const d = await detail(req.params.id, req.session!.userId);
      return d ?? reply.code(404).send({ error: 'not_found' });
    });

    r.put('/v1/me/splits/:id/shares/:shareId/settled', { schema: { params: shareParam, body: settleBody } }, async (req, reply) => {
      const me = req.session!.userId;
      const [split] = await db.select().from(tables.splits).where(eq(tables.splits.id, req.params.id));
      if (!split) return reply.code(404).send({ error: 'not_found' });
      const [share] = await db.select().from(tables.splitShares).where(and(eq(tables.splitShares.id, req.params.shareId), eq(tables.splitShares.splitId, split.id)));
      if (!share) return reply.code(404).send({ error: 'not_found' });
      // the creator settles anyone's share; a participant settles their own
      if (split.creatorId !== me && share.userId !== me) return reply.code(404).send({ error: 'not_found' });
      if (share.userId === split.creatorId) return reply.code(409).send({ error: 'creator_share' });
      await db
        .update(tables.splitShares)
        .set({ settledAt: req.body.settled ? new Date() : null })
        .where(eq(tables.splitShares.id, share.id));
      return detail(split.id, me);
    });

    /** A fresh invite link for a guest slot that nobody has joined yet (the creator only; the earlier link stops working). */
    r.post('/v1/me/splits/:id/shares/:shareId/invite', { schema: { params: shareParam } }, async (req, reply) => {
      const me = req.session!.userId;
      const [split] = await db.select().from(tables.splits).where(and(eq(tables.splits.id, req.params.id), eq(tables.splits.creatorId, me)));
      if (!split) return reply.code(404).send({ error: 'not_found' });
      const [share] = await db.select().from(tables.splitShares).where(and(eq(tables.splitShares.id, req.params.shareId), eq(tables.splitShares.splitId, split.id)));
      if (!share) return reply.code(404).send({ error: 'not_found' });
      if (share.userId !== null) return reply.code(409).send({ error: 'already_joined' });
      const { token, hash } = generateToken();
      await db.transaction(async (tx) => {
        await tx.delete(tables.invites).where(and(eq(tables.invites.splitShareId, share.id), isNull(tables.invites.acceptedBy)));
        await tx.insert(tables.invites).values({ codeHash: hash, inviterId: me, splitShareId: share.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
      });
      return reply.code(201).send({ code: token, expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString() });
    });

    r.delete('/v1/me/splits/:id', { schema: { params: idParam } }, async (req, reply) => {
      const done = await db
        .delete(tables.splits)
        .where(and(eq(tables.splits.id, req.params.id), eq(tables.splits.creatorId, req.session!.userId)))
        .returning({ id: tables.splits.id });
      return done.length ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
    });

    r.get('/v1/me/balances', async (req) => balances(db, req.session!.userId));
  };
}

/** Net open amounts between me and every other person, from unsettled shares of the splits we have in common. */
export async function balances(db: Db, me: string) {
  const currency = await mainCurrency(db, me);
  const owed = new Map<string, number>();
  const owe = new Map<string, number>();
  // others owe me: unsettled shares in splits I created
  const toMe = await db
    .select({ userId: tables.splitShares.userId, amount: tables.splitShares.amountMinor })
    .from(tables.splitShares)
    .innerJoin(tables.splits, eq(tables.splits.id, tables.splitShares.splitId))
    .where(and(eq(tables.splits.creatorId, me), eq(tables.splits.currency, currency), isNull(tables.splitShares.settledAt)));
  for (const x of toMe) if (x.userId && x.userId !== me) owed.set(x.userId, (owed.get(x.userId) ?? 0) + x.amount);
  // I owe others: my unsettled shares in splits somebody else created
  const fromMe = await db
    .select({ creator: tables.splits.creatorId, amount: tables.splitShares.amountMinor })
    .from(tables.splitShares)
    .innerJoin(tables.splits, eq(tables.splits.id, tables.splitShares.splitId))
    .where(and(eq(tables.splitShares.userId, me), eq(tables.splits.currency, currency), isNull(tables.splitShares.settledAt)));
  for (const x of fromMe) if (x.creator !== me) owe.set(x.creator, (owe.get(x.creator) ?? 0) + x.amount);
  const ids = [...new Set([...owed.keys(), ...owe.keys()])];
  const users = await publicUsers(db, ids);
  const friends = ids.map((id) => ({ user: userOrGhost(users, id), owesMe: owed.get(id) ?? 0, iOwe: owe.get(id) ?? 0 }));
  return {
    currency,
    friends,
    totalOwedToMe: friends.reduce((a, f) => a + f.owesMe, 0),
    totalIOwe: friends.reduce((a, f) => a + f.iOwe, 0),
  };
}
