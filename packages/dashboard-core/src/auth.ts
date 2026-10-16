import { and, eq, sql } from 'drizzle-orm';
import { generateToken, sha256Hex } from '@lr/crypto';
import { tables, withOrg, type Db } from '@lr/db';
import { DashboardError } from './errors.ts';
import type { KeyProvider } from './keys.ts';
import { hashPassword, verifyPassword } from './password.ts';
import type { Actor, Role } from './roles.ts';
import { currentTotp, newTotpSecret, verifyTotp } from './totp.ts';

export interface AuthDeps {
  db: Db;
  keys: KeyProvider;
  now?: () => Date;
}

/** A password-only session may only be used to finish MFA, and expires quickly. */
export const PRE_MFA_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 12 * 3_600_000;
export const MAX_MFA_FAILURES = 5;

export type MfaStep = 'enrol' | 'verify';

export interface SessionInfo extends Actor {
  mfaDone: boolean;
  tokenHash: string;
}

const now = (d: AuthDeps) => (d.now?.() ?? new Date()).getTime();

// Failed MFA codes per pre-MFA session (per process). After MAX_MFA_FAILURES the session is deleted, so the
// attacker needs the password again for another five tries. Cross-process / per-user lockout is deferred.
const mfaFailures: Record<string, number> = {};

let dummyHash: Promise<string> | undefined;

interface LoginRow extends Record<string, unknown> {
  id: string;
  org_id: string;
  password_hash: string;
  totp_secret_encrypted: string | null;
  role: Role;
}

/**
 * Step 1: email + password. Returns an opaque session token (shown once, sha256 stored) with `mfa_done = false`,
 * and which MFA step comes next. Wrong email and wrong password are indistinguishable (same work, same result).
 */
export async function login(deps: AuthDeps, email: string, password: string): Promise<{ token: string; next: MfaStep } | null> {
  const res = await deps.db.execute<LoginRow>(sql`select * from merchant.find_user_for_login(${email.trim().toLowerCase()})`);
  const user = res.rows[0];
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await verifyPassword(user?.password_hash ?? (await dummyHash), password);
  if (!user || !ok) return null;
  const { token, hash } = generateToken();
  await withOrg(deps.db, user.org_id, (tx) =>
    tx.insert(tables.dashboardSessions).values({
      tokenHash: hash,
      userId: user.id,
      orgId: user.org_id,
      mfaDone: false,
      expiresAt: new Date(now(deps) + PRE_MFA_TTL_MS),
    }),
  );
  return { token, next: user.totp_secret_encrypted ? 'verify' : 'enrol' };
}

/** Resolves a token to its session, or null when unknown/expired. `mfaDone` tells whether MFA has completed. */
export async function findSession(deps: AuthDeps, token: string): Promise<SessionInfo | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const res = await deps.db.execute<{ user_id: string; org_id: string; mfa_done: boolean; expires_at: Date; role: Role }>(
    sql`select * from merchant.find_dashboard_session(${tokenHash})`,
  );
  const row = res.rows[0];
  if (!row || new Date(row.expires_at).getTime() <= now(deps)) return null;
  return { userId: row.user_id, orgId: row.org_id, role: row.role, mfaDone: row.mfa_done, tokenHash };
}

/** The authenticated actor for a request: a session that finished MFA. Null otherwise. */
export async function resolveSession(deps: AuthDeps, token: string): Promise<SessionInfo | null> {
  const s = await findSession(deps, token);
  return s?.mfaDone ? s : null;
}

async function pendingSession(deps: AuthDeps, token: string): Promise<SessionInfo> {
  const s = await findSession(deps, token);
  if (!s || s.mfaDone) throw new DashboardError('unauthenticated', 'no pending login');
  return s;
}

async function userTotp(deps: AuthDeps, s: SessionInfo) {
  const [u] = await withOrg(deps.db, s.orgId, (tx) =>
    tx.select({ email: tables.merchantUsers.email, totp: tables.merchantUsers.totpSecretEncrypted }).from(tables.merchantUsers).where(eq(tables.merchantUsers.id, s.userId)),
  );
  if (!u) throw new DashboardError('unauthenticated', 'no pending login');
  return u;
}

async function completeMfa(deps: AuthDeps, s: SessionInfo) {
  await withOrg(deps.db, s.orgId, (tx) =>
    tx
      .update(tables.dashboardSessions)
      .set({ mfaDone: true, expiresAt: new Date(now(deps) + SESSION_TTL_MS) })
      .where(eq(tables.dashboardSessions.tokenHash, s.tokenHash)),
  );
  delete mfaFailures[s.tokenHash];
}

async function failMfa(deps: AuthDeps, s: SessionInfo): Promise<never> {
  const n = (mfaFailures[s.tokenHash] = (mfaFailures[s.tokenHash] ?? 0) + 1);
  await withOrg(deps.db, s.orgId, async (tx) => {
    await tx.insert(tables.auditLog).values({ event: 'dashboard_mfa_failed', orgId: s.orgId, detail: { userId: s.userId, attempt: n } });
    if (n >= MAX_MFA_FAILURES) await tx.delete(tables.dashboardSessions).where(eq(tables.dashboardSessions.tokenHash, s.tokenHash));
  });
  if (n >= MAX_MFA_FAILURES) delete mfaFailures[s.tokenHash];
  throw new DashboardError('unauthenticated', 'invalid code');
}

/**
 * Step 2a (first login): generate a TOTP seed to show once (otpauth URI + base32 secret). Nothing is stored yet:
 * `enrolToken` is the seed encrypted with the KeyProvider and bound to this session, and comes back with the code.
 */
export async function beginTotpEnrol(deps: AuthDeps, token: string) {
  const s = await pendingSession(deps, token);
  const u = await userTotp(deps, s);
  if (u.totp) throw new DashboardError('conflict', 'TOTP already enrolled');
  const { secret, uri } = newTotpSecret(u.email);
  const enrolToken = await deps.keys.encrypt(JSON.stringify({ secret, session: s.tokenHash, exp: now(deps) + PRE_MFA_TTL_MS }));
  return { secret, uri, enrolToken };
}

/** Step 2a (cont.): verify the first code, persist the encrypted seed, and complete MFA. */
export async function confirmTotpEnrol(deps: AuthDeps, token: string, enrolToken: string, code: string): Promise<void> {
  const s = await pendingSession(deps, token);
  let secret: string;
  try {
    const p: unknown = JSON.parse(await deps.keys.decrypt(enrolToken));
    if (typeof p !== 'object' || p === null || !('secret' in p) || !('session' in p) || !('exp' in p)) throw new Error('shape');
    if (p.session !== s.tokenHash || typeof p.exp !== 'number' || p.exp < now(deps) || typeof p.secret !== 'string') throw new Error('mismatch');
    secret = p.secret;
  } catch {
    throw new DashboardError('validation', 'invalid enrolment token');
  }
  if (!verifyTotp(secret, code, now(deps))) return failMfa(deps, s);
  const stored = await deps.keys.encrypt(secret);
  const updated = await withOrg(deps.db, s.orgId, (tx) =>
    tx
      .update(tables.merchantUsers)
      .set({ totpSecretEncrypted: stored })
      .where(and(eq(tables.merchantUsers.id, s.userId), sql`${tables.merchantUsers.totpSecretEncrypted} is null`))
      .returning({ id: tables.merchantUsers.id }),
  );
  if (updated.length === 0) throw new DashboardError('conflict', 'TOTP already enrolled');
  await completeMfa(deps, s);
}

/** Step 2b (later logins): verify a TOTP code; on success the session becomes `mfa_done` and gets its full lifetime. */
export async function verifyTotpLogin(deps: AuthDeps, token: string, code: string): Promise<void> {
  const s = await pendingSession(deps, token);
  const u = await userTotp(deps, s);
  if (!u.totp) throw new DashboardError('conflict', 'TOTP not enrolled');
  if (!verifyTotp(await deps.keys.decrypt(u.totp), code, now(deps))) return failMfa(deps, s);
  await completeMfa(deps, s);
}

export async function logout(deps: AuthDeps, token: string): Promise<void> {
  const s = await findSession(deps, token);
  if (!s) return;
  await withOrg(deps.db, s.orgId, (tx) => tx.delete(tables.dashboardSessions).where(eq(tables.dashboardSessions.tokenHash, s.tokenHash)));
}

export type SessionStatus = { state: 'anonymous' } | { state: 'mfa_enrol' } | { state: 'mfa_verify' } | { state: 'ready'; session: SessionInfo };

/** Where a token stands: unknown/expired, password done and MFA pending (enrol or verify), or fully signed in. */
export async function sessionStatus(deps: AuthDeps, token: string): Promise<SessionStatus> {
  const s = await findSession(deps, token);
  if (!s) return { state: 'anonymous' };
  if (s.mfaDone) return { state: 'ready', session: s };
  const u = await userTotp(deps, s);
  return { state: u.totp ? 'mfa_verify' : 'mfa_enrol' };
}

/** Profile for the signed-in user (email + organisation name). */
export async function currentUser(db: Db, actor: Actor) {
  return withOrg(db, actor.orgId, async (tx) => {
    const [u] = await tx.select({ id: tables.merchantUsers.id, email: tables.merchantUsers.email, role: tables.merchantUsers.role }).from(tables.merchantUsers).where(eq(tables.merchantUsers.id, actor.userId));
    const [o] = await tx.select({ legalName: tables.organizations.legalName }).from(tables.organizations);
    if (!u || !o) throw new DashboardError('not_found', 'user not found');
    return { ...u, orgName: o.legalName };
  });
}

/**
 * Demo only (the web app gates this behind DEMO_MODE): password login plus MFA in one call, answering the TOTP
 * challenge with the code generated from the user's own seed. Same sessions and checks as the normal flow.
 */
export async function demoLogin(deps: AuthDeps, email: string, password: string): Promise<{ token: string } | null> {
  const r = await login(deps, email, password);
  if (!r) return null;
  if (r.next === 'enrol') {
    const e = await beginTotpEnrol(deps, r.token);
    await confirmTotpEnrol(deps, r.token, e.enrolToken, currentTotp(e.secret, now(deps)));
  } else {
    const s = await pendingSession(deps, r.token);
    const u = await userTotp(deps, s);
    await verifyTotpLogin(deps, r.token, currentTotp(await deps.keys.decrypt(u.totp!), now(deps)));
  }
  return { token: r.token };
}
