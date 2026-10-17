import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { tables, type Db } from '@lr/db';
import type { PublicUser } from '@lr/schema';

/** Shared helpers of the friends / shares / splits routes. Everything here is buyer-side only. */

export async function publicUsers(db: Db, ids: string[]): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await db
    .select({ id: tables.users.id, handle: tables.users.handle, displayName: tables.users.displayName, avatar: tables.users.avatar })
    .from(tables.users)
    .where(and(inArray(tables.users.id, unique), isNull(tables.users.deletedAt)));
  for (const r of rows) out.set(r.id, { userId: r.id, handle: r.handle, displayName: r.displayName, avatar: r.avatar });
  return out;
}

/** A user the viewer may see even if the account is gone: a neutral placeholder instead of leaking a deletion. */
export function userOrGhost(map: Map<string, PublicUser>, id: string): PublicUser {
  return map.get(id) ?? { userId: id, handle: null, displayName: null, avatar: null };
}

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tables.friendships.id })
    .from(tables.friendships)
    .where(
      and(
        eq(tables.friendships.status, 'accepted'),
        or(
          and(eq(tables.friendships.requesterId, a), eq(tables.friendships.addresseeId, b)),
          and(eq(tables.friendships.requesterId, b), eq(tables.friendships.addresseeId, a)),
        ),
      ),
    );
  return row !== undefined;
}

export async function friendIdsOf(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ r: tables.friendships.requesterId, a: tables.friendships.addresseeId })
    .from(tables.friendships)
    .where(and(eq(tables.friendships.status, 'accepted'), or(eq(tables.friendships.requesterId, userId), eq(tables.friendships.addresseeId, userId))));
  return rows.map((x) => (x.r === userId ? x.a : x.r));
}

/** True when `userId` has claimed (saved) the receipt: only the person who saved a receipt may share or split it. */
export async function hasClaimed(db: Db, receiptId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ receiptId: tables.claims.receiptId })
    .from(tables.claims)
    .where(and(eq(tables.claims.receiptId, receiptId), eq(tables.claims.userId, userId)));
  return row !== undefined;
}

/** drizzle wraps the pg error: the SQLSTATE sits on `cause` */
export const isUniqueViolation = (e: unknown): boolean => {
  const c = typeof e === 'object' && e !== null && 'cause' in e ? (e as { cause: unknown }).cause : e;
  return typeof c === 'object' && c !== null && 'code' in c && (c as { code: unknown }).code === '23505';
};
