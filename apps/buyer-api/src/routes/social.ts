import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateToken, sha256Hex } from '@lr/crypto';
import { tables } from '@lr/db';
import { friendRequestBody, inviteAcceptBody, profileBody, reactionBody, shareCreateBody, uuidString, type PublicUser } from '@lr/schema';
import type { AppDeps } from '../context.ts';
import { loadReceipt } from '../receipts.ts';
import { areFriends, hasClaimed, isUniqueViolation, publicUsers, userOrGhost } from '../social.ts';
import { requireSession } from './auth.ts';

const INVITE_TTL_MS = 30 * 86_400_000;
const idParam = z.object({ id: uuidString });
const userParam = z.object({ userId: uuidString });

/** Profile, friends, invites, receipt shares and reactions. Buyer-side only; every route needs a session. */
export function socialRoutes(deps: AppDeps) {
  return async (app: FastifyInstance) => {
    const r = app.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', requireSession(deps));
    const db = deps.db;

    // ------------------------------------------------------------ profile

    async function loadProfile(userId: string) {
      const [u] = await db
        .select({ userId: tables.users.id, email: tables.users.email, handle: tables.users.handle, displayName: tables.users.displayName, avatar: tables.users.avatar })
        .from(tables.users)
        .where(eq(tables.users.id, userId));
      return u;
    }

    r.get('/v1/me/profile', async (req, reply) => {
      const u = await loadProfile(req.session!.userId);
      return u ?? reply.code(404).send({ error: 'not_found' });
    });

    r.put('/v1/me/profile', { schema: { body: profileBody } }, async (req, reply) => {
      try {
        await db
          .update(tables.users)
          .set({ displayName: req.body.displayName, handle: req.body.handle, avatar: req.body.avatar })
          .where(eq(tables.users.id, req.session!.userId));
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: 'handle_taken' });
        throw e;
      }
      return loadProfile(req.session!.userId);
    });

    // ------------------------------------------------------------ friends

    r.get('/v1/me/friends', async (req) => {
      const me = req.session!.userId;
      const rows = await db
        .select()
        .from(tables.friendships)
        .where(or(eq(tables.friendships.requesterId, me), eq(tables.friendships.addresseeId, me)));
      const users = await publicUsers(
        db,
        rows.map((x) => (x.requesterId === me ? x.addresseeId : x.requesterId)),
      );
      const other = (x: (typeof rows)[number]): PublicUser => userOrGhost(users, x.requesterId === me ? x.addresseeId : x.requesterId);
      const live = (x: (typeof rows)[number]) => users.has(x.requesterId === me ? x.addresseeId : x.requesterId);
      return {
        friends: rows.filter((x) => x.status === 'accepted' && live(x)).map(other),
        incoming: rows.filter((x) => x.status === 'pending' && x.addresseeId === me && live(x)).map((x) => ({ requestId: x.id, from: other(x) })),
        outgoing: rows.filter((x) => x.status === 'pending' && x.requesterId === me && live(x)).map((x) => ({ requestId: x.id, to: other(x) })),
      };
    });

    r.post('/v1/me/friends/requests', { schema: { body: friendRequestBody } }, async (req, reply) => {
      const me = req.session!.userId;
      const [target] = await db
        .select({ id: tables.users.id })
        .from(tables.users)
        .where(and(eq(tables.users.handle, req.body.handle), isNull(tables.users.deletedAt)));
      if (!target) return reply.code(404).send({ error: 'no_such_handle' });
      if (target.id === me) return reply.code(409).send({ error: 'self' });
      const [existing] = await db
        .select()
        .from(tables.friendships)
        .where(
          or(
            and(eq(tables.friendships.requesterId, me), eq(tables.friendships.addresseeId, target.id)),
            and(eq(tables.friendships.requesterId, target.id), eq(tables.friendships.addresseeId, me)),
          ),
        );
      if (existing) {
        if (existing.status === 'accepted') return reply.code(409).send({ error: 'already_friends' });
        if (existing.requesterId === me) return reply.code(409).send({ error: 'already_requested' });
        // they asked me first: asking back is accepting
        await db.update(tables.friendships).set({ status: 'accepted', respondedAt: new Date() }).where(eq(tables.friendships.id, existing.id));
        return reply.code(201).send({ status: 'accepted' });
      }
      try {
        await db.insert(tables.friendships).values({ requesterId: me, addresseeId: target.id });
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: 'already_requested' });
        throw e;
      }
      return reply.code(201).send({ status: 'requested' });
    });

    r.post('/v1/me/friends/requests/:id/accept', { schema: { params: idParam } }, async (req, reply) => {
      const done = await db
        .update(tables.friendships)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(and(eq(tables.friendships.id, req.params.id), eq(tables.friendships.addresseeId, req.session!.userId), eq(tables.friendships.status, 'pending')))
        .returning({ id: tables.friendships.id });
      return done.length ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
    });

    r.post('/v1/me/friends/requests/:id/decline', { schema: { params: idParam } }, async (req, reply) => {
      const done = await db
        .delete(tables.friendships)
        .where(and(eq(tables.friendships.id, req.params.id), eq(tables.friendships.addresseeId, req.session!.userId), eq(tables.friendships.status, 'pending')))
        .returning({ id: tables.friendships.id });
      return done.length ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
    });

    r.delete('/v1/me/friends/:userId', { schema: { params: userParam } }, async (req, reply) => {
      const me = req.session!.userId;
      const other = req.params.userId;
      await db
        .delete(tables.friendships)
        .where(
          or(
            and(eq(tables.friendships.requesterId, me), eq(tables.friendships.addresseeId, other)),
            and(eq(tables.friendships.requesterId, other), eq(tables.friendships.addresseeId, me)),
          ),
        );
      return reply.code(204).send();
    });

    // ------------------------------------------------------------ invites

    r.post('/v1/me/invites', async (req, reply) => {
      const { token, hash } = generateToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      await db.insert(tables.invites).values({ codeHash: hash, inviterId: req.session!.userId, expiresAt });
      return reply.code(201).send({ code: token, expiresAt: expiresAt.toISOString() });
    });

    r.post('/v1/me/invites/accept', { schema: { body: inviteAcceptBody } }, async (req, reply) => {
      const me = req.session!.userId;
      const [inv] = await db.select().from(tables.invites).where(eq(tables.invites.codeHash, sha256Hex(req.body.code)));
      if (!inv || inv.acceptedBy !== null || inv.expiresAt.getTime() < Date.now()) return reply.code(404).send({ error: 'invalid_invite' });
      if (inv.inviterId === me) return reply.code(409).send({ error: 'self' });

      let splitId: string | null = null;
      if (inv.splitShareId) {
        const [slot] = await db.select().from(tables.splitShares).where(eq(tables.splitShares.id, inv.splitShareId));
        if (slot) {
          const [dup] = await db
            .select({ id: tables.splitShares.id })
            .from(tables.splitShares)
            .where(and(eq(tables.splitShares.splitId, slot.splitId), eq(tables.splitShares.userId, me)));
          if (dup) return reply.code(409).send({ error: 'already_in_split' });
          if (slot.userId === null) await db.update(tables.splitShares).set({ userId: me }).where(eq(tables.splitShares.id, slot.id));
          splitId = slot.splitId;
        }
      }

      const [existing] = await db
        .select()
        .from(tables.friendships)
        .where(
          or(
            and(eq(tables.friendships.requesterId, me), eq(tables.friendships.addresseeId, inv.inviterId)),
            and(eq(tables.friendships.requesterId, inv.inviterId), eq(tables.friendships.addresseeId, me)),
          ),
        );
      if (!existing) await db.insert(tables.friendships).values({ requesterId: inv.inviterId, addresseeId: me, status: 'accepted', respondedAt: new Date() });
      else if (existing.status !== 'accepted') await db.update(tables.friendships).set({ status: 'accepted', respondedAt: new Date() }).where(eq(tables.friendships.id, existing.id));

      await db.update(tables.invites).set({ acceptedBy: me, acceptedAt: new Date() }).where(eq(tables.invites.codeHash, inv.codeHash));
      const friend = userOrGhost(await publicUsers(db, [inv.inviterId]), inv.inviterId);
      return { friend, splitId };
    });

    // ------------------------------------------------------------ shares

    /** Merchant name and total of the latest version, for a list of receipts. */
    async function summaries(ids: string[]) {
      const out = new Map<string, { merchantName: string; total: number; currency: string }>();
      for (const id of new Set(ids)) {
        const rec = await loadReceipt(db, id);
        if (rec) out.set(id, { merchantName: rec.crf.merchant.name, total: rec.totalMinor, currency: rec.currency });
      }
      return out;
    }

    r.post('/v1/me/shares', { schema: { body: shareCreateBody } }, async (req, reply) => {
      const me = req.session!.userId;
      if (!(await hasClaimed(db, req.body.receiptId, me))) return reply.code(404).send({ error: 'not_found' });
      if (!(await areFriends(db, me, req.body.friendId))) return reply.code(403).send({ error: 'not_friends' });
      const [row] = await db
        .insert(tables.receiptShares)
        .values({ receiptId: req.body.receiptId, fromUserId: me, toUserId: req.body.friendId })
        .onConflictDoNothing()
        .returning({ id: tables.receiptShares.id });
      if (row) return reply.code(201).send({ id: row.id });
      const [existing] = await db
        .select({ id: tables.receiptShares.id })
        .from(tables.receiptShares)
        .where(and(eq(tables.receiptShares.receiptId, req.body.receiptId), eq(tables.receiptShares.fromUserId, me), eq(tables.receiptShares.toUserId, req.body.friendId)));
      return reply.code(201).send({ id: existing!.id });
    });

    r.get('/v1/me/shares', async (req) => {
      const me = req.session!.userId;
      const rows = await db
        .select()
        .from(tables.receiptShares)
        .where(or(eq(tables.receiptShares.fromUserId, me), eq(tables.receiptShares.toUserId, me)))
        .orderBy(desc(tables.receiptShares.createdAt))
        .limit(100);
      const users = await publicUsers(db, rows.flatMap((x) => [x.fromUserId, x.toUserId]));
      const sums = await summaries(rows.map((x) => x.receiptId));
      const mine = rows.length
        ? await db.select().from(tables.shareReactions).where(and(eq(tables.shareReactions.userId, me), inArray(tables.shareReactions.shareId, rows.map((x) => x.id))))
        : [];
      const reaction = new Map(mine.map((x) => [x.shareId, x.emoji]));
      const item = (x: (typeof rows)[number]) => {
        const s = sums.get(x.receiptId);
        return {
          id: x.id,
          from: userOrGhost(users, x.fromUserId),
          receiptId: x.receiptId,
          merchantName: s?.merchantName ?? '',
          total: s?.total ?? 0,
          currency: s?.currency ?? 'EUR',
          sharedAt: x.createdAt.toISOString(),
          myReaction: (reaction.get(x.id) ?? null) as never,
        };
      };
      return {
        incoming: rows.filter((x) => x.toUserId === me).map(item),
        outgoing: rows.filter((x) => x.fromUserId === me).map((x) => ({ ...item(x), to: userOrGhost(users, x.toUserId) })),
      };
    });

    r.get('/v1/me/shares/:id', { schema: { params: idParam } }, async (req, reply) => {
      const me = req.session!.userId;
      const [share] = await db.select().from(tables.receiptShares).where(eq(tables.receiptShares.id, req.params.id));
      if (!share || (share.toUserId !== me && share.fromUserId !== me)) return reply.code(404).send({ error: 'not_found' });
      const receipt = await loadReceipt(db, share.receiptId);
      if (!receipt) return reply.code(404).send({ error: 'not_found' });
      const reactions = await db.select().from(tables.shareReactions).where(eq(tables.shareReactions.shareId, share.id));
      const users = await publicUsers(db, [share.fromUserId, ...reactions.map((x) => x.userId)]);
      return {
        share: {
          id: share.id,
          from: userOrGhost(users, share.fromUserId),
          receiptId: share.receiptId,
          merchantName: receipt.crf.merchant.name,
          total: receipt.totalMinor,
          currency: receipt.currency,
          sharedAt: share.createdAt.toISOString(),
          myReaction: (reactions.find((x) => x.userId === me)?.emoji ?? null) as never,
        },
        receipt: receipt.crf,
        template: receipt.template,
        reactions: reactions.map((x) => ({ user: userOrGhost(users, x.userId), emoji: x.emoji as never })),
      };
    });

    r.put('/v1/me/shares/:id/reaction', { schema: { params: idParam, body: reactionBody } }, async (req, reply) => {
      const me = req.session!.userId;
      const [share] = await db.select().from(tables.receiptShares).where(eq(tables.receiptShares.id, req.params.id));
      if (!share || (share.toUserId !== me && share.fromUserId !== me)) return reply.code(404).send({ error: 'not_found' });
      if (req.body.emoji === null) {
        await db.delete(tables.shareReactions).where(and(eq(tables.shareReactions.shareId, share.id), eq(tables.shareReactions.userId, me)));
      } else {
        await db
          .insert(tables.shareReactions)
          .values({ shareId: share.id, userId: me, emoji: req.body.emoji })
          .onConflictDoUpdate({ target: [tables.shareReactions.shareId, tables.shareReactions.userId], set: { emoji: req.body.emoji, createdAt: new Date() } });
      }
      return reply.code(204).send();
    });
  };
}
