import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { tables, withOrg, type Db, type Tx } from '@lr/db';
import { DashboardError, isUniqueViolation } from './errors.ts';
import { hashPassword } from './password.ts';
import { requireRole, ROLES, type Actor } from './roles.ts';

export const MIN_PASSWORD_LENGTH = 12;

export const userInput = z
  .object({
    email: z.email().max(200),
    password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
    role: z.enum(ROLES),
  })
  .strict();

const cols = { id: tables.merchantUsers.id, email: tables.merchantUsers.email, role: tables.merchantUsers.role, mfaEnrolled: sql<boolean>`${tables.merchantUsers.totpSecretEncrypted} is not null`, createdAt: tables.merchantUsers.createdAt };

export async function listUsers(db: Db, actor: Actor) {
  requireRole(actor, 'users.read');
  return withOrg(db, actor.orgId, (tx) => tx.select(cols).from(tables.merchantUsers).orderBy(asc(tables.merchantUsers.email)));
}

export async function createUser(db: Db, actor: Actor, input: unknown) {
  requireRole(actor, 'users.write');
  const v = userInput.safeParse(input);
  if (!v.success) throw new DashboardError('validation', v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const passwordHash = await hashPassword(v.data.password);
  try {
    const [row] = await withOrg(db, actor.orgId, async (tx) => {
      const rows = await tx
        .insert(tables.merchantUsers)
        .values({ orgId: actor.orgId, email: v.data.email.toLowerCase(), passwordHash, role: v.data.role })
        .returning(cols);
      await tx.insert(tables.auditLog).values({ event: 'user_created', orgId: actor.orgId, detail: { userId: actor.userId, role: v.data.role } });
      return rows;
    });
    return row!;
  } catch (e) {
    if (isUniqueViolation(e)) throw new DashboardError('conflict', 'a user with this email already exists');
    throw e;
  }
}

async function ownerCount(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(tables.merchantUsers).where(eq(tables.merchantUsers.role, 'owner'));
  return r?.n ?? 0;
}

/** Change a role. The last owner cannot be demoted (the organisation would lock itself out). */
export async function updateUserRole(db: Db, actor: Actor, userId: string, role: unknown) {
  requireRole(actor, 'users.write');
  const r = z.enum(ROLES).safeParse(role);
  if (!r.success) throw new DashboardError('validation', 'unknown role');
  return withOrg(db, actor.orgId, async (tx) => {
    const [u] = await tx.select({ role: tables.merchantUsers.role }).from(tables.merchantUsers).where(eq(tables.merchantUsers.id, userId));
    if (!u) throw new DashboardError('not_found', 'user not found');
    if (u.role === 'owner' && r.data !== 'owner' && (await ownerCount(tx)) <= 1) throw new DashboardError('conflict', 'the last owner cannot be demoted');
    const [row] = await tx.update(tables.merchantUsers).set({ role: r.data }).where(eq(tables.merchantUsers.id, userId)).returning(cols);
    await tx.insert(tables.auditLog).values({ event: 'user_role_changed', orgId: actor.orgId, detail: { userId: actor.userId, target: userId, role: r.data } });
    return row!;
  });
}

/** Delete a user (their sessions cascade). You cannot delete yourself or the last owner. */
export async function deleteUser(db: Db, actor: Actor, userId: string): Promise<void> {
  requireRole(actor, 'users.write');
  if (userId === actor.userId) throw new DashboardError('conflict', 'you cannot delete yourself');
  await withOrg(db, actor.orgId, async (tx) => {
    const [u] = await tx.select({ role: tables.merchantUsers.role }).from(tables.merchantUsers).where(eq(tables.merchantUsers.id, userId));
    if (!u) throw new DashboardError('not_found', 'user not found');
    if (u.role === 'owner' && (await ownerCount(tx)) <= 1) throw new DashboardError('conflict', 'the last owner cannot be deleted');
    await tx.delete(tables.merchantUsers).where(eq(tables.merchantUsers.id, userId));
    await tx.insert(tables.auditLog).values({ event: 'user_deleted', orgId: actor.orgId, detail: { userId: actor.userId, target: userId } });
  });
}

/** Clear a user's TOTP seed so they enrol a new authenticator at next login (lost phone). Also ends their sessions. */
export async function resetUserTotp(db: Db, actor: Actor, userId: string): Promise<void> {
  requireRole(actor, 'users.write');
  await withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.update(tables.merchantUsers).set({ totpSecretEncrypted: null }).where(eq(tables.merchantUsers.id, userId)).returning({ id: tables.merchantUsers.id });
    if (rows.length === 0) throw new DashboardError('not_found', 'user not found');
    await tx.delete(tables.dashboardSessions).where(eq(tables.dashboardSessions.userId, userId));
    await tx.insert(tables.auditLog).values({ event: 'user_totp_reset', orgId: actor.orgId, detail: { userId: actor.userId, target: userId } });
  });
}
