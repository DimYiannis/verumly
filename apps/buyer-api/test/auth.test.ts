import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, createWorld, loginUser, sql, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

let counter = 0;
const fresh = () => `auth-${Date.now()}-${counter++}@example.test`;
const start = (email: string) => buyerCall(w, 'POST', '/v1/auth/email/start', { body: { email } });
const verify = (email: string, code: string) => buyerCall(w, 'POST', '/v1/auth/email/verify', { body: { email, code } });
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

describe('e-mail code login', () => {
  it('start → verify returns a token and a user id; the code is single-use', async () => {
    const email = fresh();
    expect((await start(email)).status).toBe(202);
    const code = w.codes[email]!;
    const ok = await verify(email, code);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), userId: expect.any(String) });
    expect((await verify(email, code)).status).toBe(401);
  });

  it('only hashes are stored: not the code, not the session token', async () => {
    const email = fresh();
    await start(email);
    const code = w.codes[email]!;
    const ok = await verify(email, code);
    const token = (ok.body as { token: string }).token;
    const codes = await sql<{ t: string }>(w, 'select row_to_json(c)::text t from buyer.email_codes c where email = $1', [email]);
    expect(codes.map((c) => c.t).join()).not.toContain(code);
    const sessions = await sql<{ t: string }>(w, 'select row_to_json(s)::text t from buyer.sessions s');
    expect(sessions.map((s) => s.t).join()).not.toContain(token);
  });

  it('the same answer for known and unknown addresses (no account enumeration)', async () => {
    const known = fresh();
    await loginUser(w, known);
    const a = await start(known);
    const b = await start(fresh());
    expect([a.status, a.body]).toEqual([b.status, b.body]);
  });

  it('addresses are case-insensitive: one account, not two', async () => {
    const base = fresh();
    const first = await loginUser(w, base);
    expect((await start(base.toUpperCase())).status).toBe(202);
    const code = w.codes[base.toLowerCase()]!;
    const second = await verify(`${base.toUpperCase()}`, code);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ userId: first.userId });
  });

  it('a wrong code → 401; after 5 wrong attempts even the right code is refused', async () => {
    const email = fresh();
    await start(email);
    const code = w.codes[email]!;
    for (let i = 0; i < 5; i++) expect((await verify(email, wrong(code))).status).toBe(401);
    expect((await verify(email, code)).status).toBe(401);
    // a fresh code works again
    await start(email);
    expect((await verify(email, w.codes[email]!)).status).toBe(200);
  });

  it('4 wrong attempts still leave the right code usable', async () => {
    const email = fresh();
    await start(email);
    const code = w.codes[email]!;
    for (let i = 0; i < 4; i++) await verify(email, wrong(code));
    expect((await verify(email, code)).status).toBe(200);
  });

  it('an expired code is refused', async () => {
    const email = fresh();
    await start(email);
    await sql(w, "update buyer.email_codes set expires_at = now() - interval '1 second' where email = $1", [email]);
    expect((await verify(email, w.codes[email]!)).status).toBe(401);
  });

  it('a code for one address does not work for another', async () => {
    const a = fresh();
    const b = fresh();
    await start(a);
    await start(b);
    expect((await verify(b, w.codes[a]!)).status).toBe(401);
  });

  it('at most 5 codes per address per hour: the 6th start → 429', async () => {
    const email = fresh();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await start(email)).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect((await start(fresh())).status).toBe(202);
  });

  it('concurrent verification of one code: exactly one session is issued', async () => {
    const email = fresh();
    await start(email);
    const code = w.codes[email]!;
    const results = await Promise.all(Array.from({ length: 8 }, () => verify(email, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(7);
  });

  it('malformed input is a 400, never a lookup', async () => {
    expect((await buyerCall(w, 'POST', '/v1/auth/email/start', { body: { email: 'not-an-email' } })).status).toBe(400);
    expect((await buyerCall(w, 'POST', '/v1/auth/email/verify', { body: { email: fresh(), code: '12345' } })).status).toBe(400);
    expect((await buyerCall(w, 'POST', '/v1/auth/email/verify', { body: { email: fresh(), code: 'abcdef' } })).status).toBe(400);
  });
});

describe('sessions', () => {
  it('an expired session is refused; logout kills the token; other sessions of the same user survive', async () => {
    const email = fresh();
    const one = await loginUser(w, email);
    const two = await loginUser(w, email);
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: one.token })).status).toBe(200);
    await sql(w, "update buyer.sessions set expires_at = now() - interval '1 second' where user_id = $1 and token_hash = encode(sha256(convert_to($2, 'UTF8')), 'hex')", [one.userId, one.token]);
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: one.token })).status).toBe(401);
    expect((await buyerCall(w, 'POST', '/v1/auth/logout', { token: two.token })).status).toBe(204);
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: two.token })).status).toBe(401);
  });

  it('every /v1/me route needs a session', async () => {
    const claim = { receiptId: '01a14600-0000-7000-8000-000000000001', secret: 'A'.repeat(43) };
    for (const [method, url, body] of [['GET', '/v1/me/receipts', undefined], ['POST', '/v1/me/claims', claim], ['GET', `/v1/me/receipts/${claim.receiptId}`, undefined]] as const) {
      expect((await buyerCall(w, method, url, { body })).status, `${method} ${url}`).toBe(401);
    }
    // note: authentication runs as a preHandler, i.e. AFTER body validation: an unauthenticated, malformed request gets 400, not 401
    expect((await buyerCall(w, 'POST', '/v1/me/claims', { body: {} })).status).toBe(400);
  });
});
