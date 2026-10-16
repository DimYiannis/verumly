import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tables } from '@lr/db';
import { sha256Hex } from '@lr/crypto';
import {
  beginTotpEnrol,
  confirmTotpEnrol,
  currentTotp,
  DashboardError,
  findSession,
  login,
  logout,
  MAX_MFA_FAILURES,
  resolveSession,
  SESSION_TTL_MS,
  verifyTotpLogin,
} from '../src/index.ts';
import { fixture, PASSWORD, TEST_KEY, userWithRole, type Fixture } from './helpers.ts';

let f: Fixture;
beforeAll(async () => {
  f = await fixture('dc_auth');
});
afterAll(() => f.close());

describe('login + TOTP', () => {
  it('rejects a wrong password and an unknown email the same way', async () => {
    const { email } = await userWithRole(f, 0, 'owner', 'o1@example.test');
    expect(await login(f.deps, email, 'wrong password!!')).toBeNull();
    expect(await login(f.deps, 'nobody@example.test', PASSWORD)).toBeNull();
  });

  it('enrols TOTP at first login, then verifies on the next login', async () => {
    const { actor, email } = await userWithRole(f, 0, 'owner', 'o2@example.test');
    const first = await login(f.deps, email, PASSWORD);
    expect(first?.next).toBe('enrol');
    const token = first!.token;

    // password-only session is not an authenticated actor
    expect(await resolveSession(f.deps, token)).toBeNull();
    expect((await findSession(f.deps, token))?.mfaDone).toBe(false);

    const enrol = await beginTotpEnrol(f.deps, token);
    expect(enrol.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrol.uri).toContain(enrol.secret);
    // a wrong first code does not enrol
    await expect(confirmTotpEnrol(f.deps, token, enrol.enrolToken, '000000')).rejects.toBeInstanceOf(DashboardError);
    await confirmTotpEnrol(f.deps, token, enrol.enrolToken, currentTotp(enrol.secret));

    const session = await resolveSession(f.deps, token);
    expect(session).toMatchObject({ userId: actor.userId, orgId: actor.orgId, role: 'owner', mfaDone: true });

    // the TOTP seed is encrypted at rest, and never equals the plaintext secret
    const [row] = await f.admin.select({ t: tables.merchantUsers.totpSecretEncrypted }).from(tables.merchantUsers).where(eq(tables.merchantUsers.id, actor.userId));
    expect(row!.t).toMatch(/^v1\./);
    expect(row!.t).not.toContain(enrol.secret);

    // next login: verify path
    const second = await login(f.deps, email, PASSWORD);
    expect(second?.next).toBe('verify');
    await expect(beginTotpEnrol(f.deps, second!.token)).rejects.toMatchObject({ code: 'conflict' });
    await expect(verifyTotpLogin(f.deps, second!.token, '123456')).rejects.toBeInstanceOf(DashboardError);
    expect(await resolveSession(f.deps, second!.token)).toBeNull();
    await verifyTotpLogin(f.deps, second!.token, currentTotp(enrol.secret));
    expect((await resolveSession(f.deps, second!.token))?.userId).toBe(actor.userId);
  });

  it('stores only sha256 of the session token, and logout ends the session', async () => {
    const { email } = await userWithRole(f, 0, 'manager', 'm1@example.test');
    const l = await login(f.deps, email, PASSWORD);
    const e = await beginTotpEnrol(f.deps, l!.token);
    await confirmTotpEnrol(f.deps, l!.token, e.enrolToken, currentTotp(e.secret));
    const rows = await f.admin.select({ h: tables.dashboardSessions.tokenHash }).from(tables.dashboardSessions);
    expect(rows.map((r) => r.h)).toContain(sha256Hex(l!.token));
    expect(rows.map((r) => r.h)).not.toContain(l!.token);
    await logout(f.deps, l!.token);
    expect(await resolveSession(f.deps, l!.token)).toBeNull();
  });

  it('an enrolment token cannot be used from another session', async () => {
    const a = await userWithRole(f, 0, 'accountant', 'a1@example.test');
    const b = await userWithRole(f, 0, 'accountant', 'a2@example.test');
    const la = await login(f.deps, a.email, PASSWORD);
    const lb = await login(f.deps, b.email, PASSWORD);
    const ea = await beginTotpEnrol(f.deps, la!.token);
    await expect(confirmTotpEnrol(f.deps, lb!.token, ea.enrolToken, currentTotp(ea.secret))).rejects.toMatchObject({ code: 'validation' });
  });

  it('expires pre-MFA sessions after 10 minutes and full sessions after 12 hours', async () => {
    const { email } = await userWithRole(f, 0, 'owner', 'o3@example.test');
    const t0 = Date.now();
    const clock = { now: () => new Date(t0) };
    const l = await login({ ...f.deps, ...clock }, email, PASSWORD);
    expect(await findSession({ ...f.deps, now: () => new Date(t0 + 9 * 60_000) }, l!.token)).not.toBeNull();
    expect(await findSession({ ...f.deps, now: () => new Date(t0 + 11 * 60_000) }, l!.token)).toBeNull();

    const e = await beginTotpEnrol({ ...f.deps, ...clock }, l!.token);
    await confirmTotpEnrol({ ...f.deps, ...clock }, l!.token, e.enrolToken, currentTotp(e.secret, t0));
    expect(await resolveSession({ ...f.deps, now: () => new Date(t0 + SESSION_TTL_MS - 1000) }, l!.token)).not.toBeNull();
    expect(await resolveSession({ ...f.deps, now: () => new Date(t0 + SESSION_TTL_MS + 1000) }, l!.token)).toBeNull();
  });

  it('deletes the session after repeated wrong codes and audits the failures', async () => {
    const { email } = await userWithRole(f, 0, 'owner', 'o4@example.test');
    const l = await login(f.deps, email, PASSWORD);
    const e = await beginTotpEnrol(f.deps, l!.token);
    for (let i = 0; i < MAX_MFA_FAILURES; i++) await expect(confirmTotpEnrol(f.deps, l!.token, e.enrolToken, '000000')).rejects.toBeInstanceOf(DashboardError);
    expect(await findSession(f.deps, l!.token)).toBeNull();
    const audit = await f.admin.select().from(tables.auditLog).where(eq(tables.auditLog.event, 'dashboard_mfa_failed'));
    expect(audit.length).toBeGreaterThanOrEqual(MAX_MFA_FAILURES);
    expect(JSON.stringify(audit)).not.toContain('o4@example.test');
  });

  it('is isolated from other orgs: a session only resolves to its own org', async () => {
    const x = await userWithRole(f, 1, 'owner', 'other-org@example.test');
    const l = await login(f.deps, x.email, PASSWORD);
    const e = await beginTotpEnrol(f.deps, l!.token);
    await confirmTotpEnrol(f.deps, l!.token, e.enrolToken, currentTotp(e.secret));
    expect((await resolveSession(f.deps, l!.token))?.orgId).toBe(f.orgs[1]!.id);
  });
});

describe('key provider', () => {
  it('rejects a key that is not 32 bytes', async () => {
    const { LocalKeyProvider } = await import('../src/index.ts');
    expect(() => new LocalKeyProvider(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    const p = new LocalKeyProvider(TEST_KEY);
    const c = await p.encrypt('secret');
    expect(await p.decrypt(c)).toBe('secret');
    const tampered = c.slice(0, -2) + (c.endsWith('AA') ? 'BB' : 'AA');
    await expect(p.decrypt(tampered)).rejects.toThrow();
  });
});
