import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, url } from '@nuxt/test-utils/e2e';
import { adminDbUrl } from '@lr/config';
import { currentTotp, createMerchantUser } from '@lr/dashboard-core';
import { connect, makeBoss, tables, type Db, type DbHandle, type PgBoss } from '@lr/db';
import { createTestDb } from '@lr/db/testing';
import { createLocation, createOrg } from '@lr/db/provision';
import { generateKeyPair } from '@lr/crypto';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { buildApp } from '../../merchant-api/src/app.ts';

const PASSWORD = 'correct horse battery staple';
let adminPool: pg.Pool;
let admin: Db;
let merchantDb: DbHandle;
let boss: PgBoss;
let merchantApi: Awaited<ReturnType<typeof buildApp>>;
let orgId = '';
let locationId = '';

// env must be in place before `setup()` launches the server process
const testDb = await createTestDb('mw_server');
const merchantPort = await new Promise<number>((resolve) => {
  const srv = createServer();
  srv.listen(0, '127.0.0.1', () => {
    const addr = srv.address();
    srv.close(() => resolve(typeof addr === 'object' && addr ? addr.port : 0));
  });
});
Object.assign(process.env, {
  PG_DATABASE: testDb.name,
  MERCHANT_API_URL: `http://127.0.0.1:${merchantPort}`,
  DASHBOARD_COOKIE_SECURE: 'false',
  DASHBOARD_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  DEMO_MODE: 'false',
});

// This builds the Nuxt app inside the setup hook. The default limit is 120 s; on a shared CI runner, with the other packages'
// tests running at the same time, the build takes longer than that.
await setup({ rootDir: fileURLToPath(new URL('..', import.meta.url)), server: true, build: true, dev: false, setupTimeout: 600_000 });

/** Minimal cookie-jar client: the same-origin browser, as far as the server can tell. */
class Browser {
  cookie = '';
  async req(path: string, init: RequestInit & { origin?: string | null } = {}) {
    const { origin, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const o = origin === undefined ? url('/') .replace(/\/$/, '') : origin;
    if (o) headers.set('origin', o);
    const res = await fetch(url(path), { ...rest, headers, redirect: 'manual' });
    const set = res.headers.getSetCookie();
    for (const c of set) this.cookie = c.split(';')[0]!;
    return res;
  }
  post(path: string, body: unknown) {
    return this.req(path, { method: 'POST', body: JSON.stringify(body) });
  }
}

async function signIn(email: string): Promise<Browser> {
  const b = new Browser();
  const login = await b.post('/api/dashboard/login', { email, password: PASSWORD });
  expect(login.status).toBe(200);
  const { next } = (await login.json()) as { next: string };
  expect(next).toBe('enrol');
  const begin = (await (await b.post('/api/dashboard/totp/begin', {})).json()) as { secret: string; enrolToken: string };
  const confirm = await b.post('/api/dashboard/totp/confirm', { enrolToken: begin.enrolToken, code: currentTotp(begin.secret) });
  expect(confirm.status).toBe(200);
  return b;
}

beforeAll(async () => {
  adminPool = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 3 });
  // `drop database … with (force)` may kill an idle client just before it has said goodbye; that must not crash the run
  adminPool.on('error', () => {});
  admin = drizzle(adminPool) as unknown as Db;
  const org = await createOrg(admin, { legalName: 'Café Het Plein B.V.', kvkNumber: '12345678', vatNumber: 'NL123456789B01' });
  orgId = org.id;
  locationId = (await createLocation(admin, org.id, 'Café Het Plein')).id;
  await createMerchantUser(admin, { orgId, email: 'owner@example.test', password: PASSWORD, role: 'owner' });
  await createMerchantUser(admin, { orgId, email: 'acct@example.test', password: PASSWORD, role: 'accountant' });
  await createMerchantUser(admin, { orgId, email: 'flow@example.test', password: PASSWORD, role: 'owner' });
  merchantDb = connect('merchant_api', testDb.env);
  boss = makeBoss('merchant_api', testDb.env);
  await boss.start();
  merchantApi = await buildApp({ db: merchantDb.db, boss, claimWindowDays: 90, logLevel: 'silent' });
  await merchantApi.listen({ port: merchantPort, host: '127.0.0.1' });
});

afterAll(async () => {
  await merchantApi?.close();
  await boss?.stop();
  await merchantDb?.close();
  await adminPool?.end();
  await testDb?.drop();
});

describe('security envelope', () => {
  it('sets security headers and never caches API responses', async () => {
    const res = await new Browser().req('/api/dashboard/session');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ state: 'anonymous' });
  });

  it('refuses state-changing /api requests that are cross-origin or carry no origin evidence', async () => {
    const body = JSON.stringify({ email: 'owner@example.test', password: PASSWORD });
    const evil = await new Browser().req('/api/dashboard/login', { method: 'POST', body, origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const none = await new Browser().req('/api/dashboard/login', { method: 'POST', body, origin: null });
    expect(none.status).toBe(403);
    const sameSite = await new Browser().req('/api/dashboard/login', { method: 'POST', body, origin: null, headers: { 'sec-fetch-site': 'same-origin' } });
    expect(sameSite.status).toBe(200);
  });

  it('requires a session for every dashboard endpoint', async () => {
    for (const p of ['org', 'locations', 'terminals', 'users', 'archive', 'exports', 'reports?from=2026-01-01&to=2026-01-02', 'billing', 'billing/notice', 'billing/invoices']) {
      expect((await new Browser().req(`/api/dashboard/${p}`)).status, p).toBe(401);
    }
  });

  it('sets an httpOnly SameSite=Lax session cookie, and rejects a wrong password', async () => {
    const bad = await new Browser().post('/api/dashboard/login', { email: 'owner@example.test', password: 'wrong password' });
    expect(bad.status).toBe(401);
    const ok = await new Browser().post('/api/dashboard/login', { email: 'owner@example.test', password: PASSWORD });
    const cookie = ok.headers.getSetCookie().find((c) => c.startsWith('lr_dashboard='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });
});

describe('dashboard flow over HTTP', () => {
  it('password-only session cannot reach data; TOTP completes it', async () => {
    const b = new Browser();
    await b.post('/api/dashboard/login', { email: 'flow@example.test', password: PASSWORD });
    expect(((await (await b.req('/api/dashboard/session')).json()) as { state: string }).state).toBe('mfa_enrol');
    expect((await b.req('/api/dashboard/org')).status).toBe(401);
    const begin = (await (await b.post('/api/dashboard/totp/begin', {})).json()) as { secret: string; uri: string; enrolToken: string };
    expect(begin.uri).toContain('otpauth://totp/');
    expect((await b.post('/api/dashboard/totp/confirm', { enrolToken: begin.enrolToken, code: '000000' })).status).toBe(401);
    expect((await b.post('/api/dashboard/totp/confirm', { enrolToken: begin.enrolToken, code: currentTotp(begin.secret) })).status).toBe(200);
    const s = (await (await b.req('/api/dashboard/session')).json()) as { state: string; user: { role: string; orgName: string } };
    expect(s).toMatchObject({ state: 'ready', user: { role: 'owner', orgName: 'Café Het Plein B.V.' } });
    // a later login by the same user asks for a code instead of enrolling
    const again = new Browser();
    const l2 = (await (await again.post('/api/dashboard/login', { email: 'flow@example.test', password: PASSWORD })).json()) as { next: string };
    expect(l2.next).toBe('verify');
    await b.post('/api/dashboard/logout', {});
    expect((await b.req('/api/dashboard/org')).status).toBe(401);
  });

  it('owner: terminal create (key once, hash only) → simulator proxy → revoke; audit entries exist', async () => {
    const owner = await signInOwner();
    const keys = generateKeyPair();
    const bad = await owner.post('/api/dashboard/terminals', { locationId, label: 'x', publicKey: 'short' });
    expect(bad.status).toBe(400);
    const created = (await (await owner.post('/api/dashboard/terminals', { locationId, label: 'Kassa 1', publicKey: keys.publicKey })).json()) as { terminalId: string; apiKey: string };
    expect(created.apiKey).toHaveLength(43);
    const listText = await (await owner.req('/api/dashboard/terminals')).text();
    expect(listText).toContain('Kassa 1');
    expect(listText).not.toContain(created.apiKey);

    // the simulator path: browser SDK → same-origin /sim-api → merchant-api
    const sdk = new TerminalSdk({
      apiBase: url('/sim-api'),
      receiptHost: 'http://localhost:3001',
      terminalId: created.terminalId,
      apiKey: created.apiKey,
      privateKey: keys.privateKey,
      merchant: { kvkNumber: '12345678', vatNumber: 'NL123456789B01', name: 'Café Het Plein B.V.', locationId },
      store: new MemoryStore(),
    });
    const r = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9 }], payments: [{ method: 'cash' }] });
    expect(await sdk.flush()).toEqual({ sent: 1, rejected: 0, retry: false });
    const archive = (await (await owner.req('/api/dashboard/archive')).json()) as Array<{ id: string; state: string; totalMinor: number }>;
    expect(archive.find((a) => a.id === r.receiptId)).toMatchObject({ state: 'paid', totalMinor: 340 });
    const detail = (await (await owner.req(`/api/dashboard/archive/${r.receiptId}`)).json()) as { versions: Array<{ version: number }> };
    expect(detail.versions).toHaveLength(1);
    const pdf = await owner.req(`/api/dashboard/archive/${r.receiptId}/pdf`);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    const report = (await (await owner.req(`/api/dashboard/reports?from=2020-01-01&to=2099-01-01`)).json()) as { sales: Array<{ gross: number; vat: number }> };
    expect(report.sales.reduce((s, x) => s + x.gross, 0)).toBe(340);

    expect((await owner.post(`/api/dashboard/terminals/${created.terminalId}/revoke`, {})).status).toBe(200);
    const after = await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9 }] });
    expect(after.receiptId).toBeTruthy();
    // revoked key: merchant-api answers 401, which the SDK dead-letters instead of retrying
    expect(await sdk.flush()).toEqual({ sent: 0, rejected: 1, retry: false });

    const events = await admin.select({ e: tables.auditLog.event }).from(tables.auditLog);
    expect(events.map((x) => x.e)).toEqual(expect.arrayContaining(['terminal_key_created', 'terminal_key_revoked']));
  });

  it('proxy only forwards /v1 and never the dashboard cookie', async () => {
    const owner = await signInOwner();
    expect((await owner.req('/sim-api/healthz')).status).toBe(404);
    expect((await owner.req('/sim-api/v1/terminals/me')).status).toBe(401); // reaches merchant-api, which wants a bearer key
  });

  it('accountant: reads and exports, no writes', async () => {
    const acct = await signInAccountant();
    expect((await acct.req('/api/dashboard/org')).status).toBe(200);
    expect((await acct.req('/api/dashboard/archive')).status).toBe(200);
    expect((await acct.req('/api/dashboard/reports?from=2026-01-01&to=2026-12-31')).status).toBe(200);
    expect((await acct.req('/api/dashboard/exports')).status).toBe(200);
    expect((await acct.post('/api/dashboard/locations', { name: 'x' })).status).toBe(403);
    expect((await acct.post('/api/dashboard/terminals', { locationId, label: 'x', publicKey: generateKeyPair().publicKey })).status).toBe(403);
    expect((await acct.req('/api/dashboard/users')).status).toBe(403);
    expect((await acct.req('/api/dashboard/org', { method: 'PUT', body: JSON.stringify({ legalName: 'x', kvkNumber: '12345678', vatNumber: null, retentionYears: 7 }) })).status).toBe(403);
  });

  it('owner: organisation, locations and users round trip', async () => {
    const owner = await signInOwner();
    const put = await owner.req('/api/dashboard/org', { method: 'PUT', body: JSON.stringify({ legalName: 'Het Plein', kvkNumber: '12345678', vatNumber: 'NL123456789B01', retentionYears: 9 }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { retentionYears: number }).retentionYears).toBe(9);
    expect((await owner.req('/api/dashboard/org', { method: 'PUT', body: JSON.stringify({ legalName: 'x', kvkNumber: '1234', vatNumber: null, retentionYears: 9 }) })).status).toBe(400);
    const loc = (await (await owner.post('/api/dashboard/locations', { name: 'Terras', postcode: '1012 AB' })).json()) as { id: string; postcode: string };
    expect(loc.postcode).toBe('1012AB');
    expect((await owner.req(`/api/dashboard/locations/${loc.id}`, { method: 'DELETE' })).status).toBe(200);
    const user = await owner.post('/api/dashboard/users', { email: 'mgr@example.test', password: PASSWORD, role: 'manager' });
    expect(user.status).toBe(200);
    const users = (await (await owner.req('/api/dashboard/users')).json()) as Array<{ email: string; role: string }>;
    expect(users.map((u) => u.email)).toEqual(expect.arrayContaining(['owner@example.test', 'mgr@example.test']));
    expect(JSON.stringify(users)).not.toMatch(/argon2|password/i);
  });

  it('serves the simulator and dashboard pages', async () => {
    for (const p of ['/simulator', '/dashboard/login', '/dashboard/archive', '/dashboard/billing', '/billing/checkout/00000000-0000-4000-8000-000000000000']) {
      const res = await fetch(url(p));
      expect(res.status, p).toBe(200);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });
});

describe('billing over HTTP (runs last: it moves the organisation to Starter)', () => {
  it('owner: trial → checkout → pay (card 4242) → active, invoice PDF; the plan limit is a 402 with its code', async () => {
    const owner = await signInOwner();
    expect(await (await owner.req('/api/dashboard/billing/notice')).json()).toEqual({ notice: null });
    const before = (await (await owner.req('/api/dashboard/billing')).json()) as { status: string; canSimulateRenewal: boolean };
    expect(before.status).toBe('trialing');
    const started = await owner.post('/api/dashboard/billing/checkout', { plan: 'starter', interval: 'monthly' });
    expect(started.status).toBe(200);
    const { id } = (await started.json()) as { id: string };
    const checkout = (await (await owner.req(`/api/dashboard/billing/checkout/${id}`)).json()) as { merchantName: string; net: number; vat: number; gross: number };
    expect(checkout).toMatchObject({ net: 1900, vat: 399, gross: 2299 });
    expect(checkout.merchantName).toBeTruthy();
    expect((await owner.post(`/api/dashboard/billing/checkout/${id}/pay`, { method: 'card', number: '4242 4242 4242 4241', expiry: '12/30', cvc: '123' })).status).toBe(400);
    const paid = await owner.post(`/api/dashboard/billing/checkout/${id}/pay`, { method: 'card', number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' });
    expect(await paid.json()).toMatchObject({ status: 'paid' });
    const after = (await (await owner.req('/api/dashboard/billing')).json()) as { status: string; plan: string; method: string };
    expect(after).toMatchObject({ status: 'active', plan: 'starter', method: 'Card •••• 4242' });
    const invoices = (await (await owner.req('/api/dashboard/billing/invoices')).json()) as Array<{ id: string; number: string }>;
    expect(invoices).toHaveLength(1);
    const pdf = await owner.req(`/api/dashboard/billing/invoices/${invoices[0]!.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain(invoices[0]!.number);
    // starter allows one location: the second is refused with 402 and the code the page uses for its Billing link
    const refused = await owner.post('/api/dashboard/locations', { name: 'Tweede zaak' });
    expect(refused.status).toBe(402);
    expect(((await refused.json()) as { data?: { code?: string } }).data?.code).toBe('plan_limit');
    // the demo renewal button follows DEMO_MODE, which is off here
    expect(before.canSimulateRenewal).toBe(false);
    expect((await owner.post('/api/dashboard/billing/simulate-renewal', {})).status).toBe(404);
  });

  it('accountant reads billing and invoices but cannot start a checkout or change the plan', async () => {
    const acct = await signInAccountant();
    expect((await acct.req('/api/dashboard/billing')).status).toBe(200);
    expect((await acct.req('/api/dashboard/billing/invoices')).status).toBe(200);
    expect((await acct.post('/api/dashboard/billing/checkout', { plan: 'business', interval: 'monthly' })).status).toBe(403);
    expect((await acct.post('/api/dashboard/billing/change', { plan: 'business', interval: 'monthly' })).status).toBe(403);
    expect((await acct.post('/api/dashboard/billing/cancel', {})).status).toBe(403);
  });
});

let ownerSession: Promise<Browser> | undefined;
let acctSession: Promise<Browser> | undefined;
// TOTP enrolment happens once per user; later tests reuse the signed-in browser
function signInOwner() {
  return (ownerSession ??= signIn('owner@example.test'));
}
function signInAccountant() {
  return (acctSession ??= signIn('acct@example.test'));
}
