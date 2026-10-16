import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newReceiptId } from '@lr/crypto';
import { buildCrf, buyerCall, claimRequest, createReceipt, createWorld, loginUser, sql, submit, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

const keys = { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) };

describe('GET /v1/me/export', () => {
  it('returns everything about the user as JSON: profile, consents, subscriptions, claimed receipts with all versions, uploads; nothing of other users and no credentials', async () => {
    const u = await loginUser(w);
    const stranger = await loginUser(w);
    const r = await createReceipt(w, w.orgA, { state: 'presented' });
    await claimRequest(w, u, r);
    expect((await submit(w.merchant, w.orgA, buildCrf({ receiptId: r.receiptId, version: 2, state: 'paid', org: w.orgA }))).status).toBe(201);
    const foreign = await createReceipt(w, w.orgA, { state: 'paid' });
    await claimRequest(w, stranger, foreign);
    await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { analytics: true } });
    await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint: 'https://push.example.test/export', keys } });
    await sql(w, "insert into buyer.uploads (user_id, s3_key, content_type, status) values ($1, 'uploads/x', 'image/png', 'failed')", [u.userId]);

    const res = await w.buyer.inject({ method: 'GET', url: '/v1/me/export', headers: { authorization: `Bearer ${u.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-type']).toContain('application/json');
    const doc = JSON.parse(res.body) as {
      user: { id: string; email: string };
      consents: Array<{ purpose: string; granted: boolean }>;
      pushSubscriptions: Array<Record<string, unknown>>;
      receipts: Array<{ receiptId: string; source: string; versions: Array<{ version: number; state: string; receipt: { totals: { gross: number } } }> }>;
      uploads: Array<{ status: string }>;
    };
    expect(doc.user).toMatchObject({ id: u.userId, email: u.email });
    expect(doc.consents).toMatchObject([{ purpose: 'analytics', granted: true }]);
    expect(doc.pushSubscriptions).toHaveLength(1);
    expect(doc.receipts).toHaveLength(1);
    expect(doc.receipts[0]).toMatchObject({ receiptId: r.receiptId, source: 'qr' });
    expect(doc.receipts[0]?.versions.map((v) => [v.version, v.state])).toEqual([[1, 'presented'], [2, 'paid']]);
    expect(doc.uploads).toMatchObject([{ status: 'failed' }]);

    // other people's data, secrets and credentials are not in it
    expect(res.body).not.toContain(foreign.receiptId);
    expect(res.body).not.toContain(stranger.email);
    expect(res.body).not.toContain(u.token);
    expect(res.body).not.toContain(keys.p256dh);
    expect(res.body).not.toContain(keys.auth);
    expect(res.body).not.toContain('claimSecretHash');
    expect(res.body).not.toContain(r.secret);
    expect((await buyerCall(w, 'GET', '/v1/me/export')).status).toBe(401);
  });
});

describe('GET /v1/me/receipts/:id/pdf', () => {
  it('renders a PDF for a receipt the user claimed; 404 for someone else’s or an unknown one', async () => {
    const u = await loginUser(w);
    const other = await loginUser(w);
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    await claimRequest(w, u, r);

    const res = await w.buyer.inject({ method: 'GET', url: `/v1/me/receipts/${r.receiptId}/pdf`, headers: { authorization: `Bearer ${u.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`receipt-${r.receiptId.slice(0, 8)}.pdf`);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(1000);
    expect(res.rawPayload.subarray(-6).toString('latin1')).toContain('%%EOF');

    expect((await w.buyer.inject({ method: 'GET', url: `/v1/me/receipts/${r.receiptId}/pdf`, headers: { authorization: `Bearer ${other.token}` } })).statusCode).toBe(404);
    expect((await w.buyer.inject({ method: 'GET', url: `/v1/me/receipts/${newReceiptId()}/pdf`, headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(404);
    expect((await w.buyer.inject({ method: 'GET', url: `/v1/me/receipts/${r.receiptId}/pdf` })).statusCode).toBe(401);
  });

  it('a pre-bill (presented) and a void receipt also render', async () => {
    const u = await loginUser(w);
    const r = await createReceipt(w, w.orgA, { state: 'presented' });
    await claimRequest(w, u, r);
    const pre = await w.buyer.inject({ method: 'GET', url: `/v1/me/receipts/${r.receiptId}/pdf`, headers: { authorization: `Bearer ${u.token}` } });
    expect(pre.statusCode).toBe(200);
    expect((await submit(w.merchant, w.orgA, buildCrf({ receiptId: r.receiptId, version: 2, state: 'void', org: w.orgA, voidOf: r.receiptId }))).status).toBe(201);
    const voided = await w.buyer.inject({ method: 'GET', url: `/v1/me/receipts/${r.receiptId}/pdf`, headers: { authorization: `Bearer ${u.token}` } });
    expect(voided.statusCode).toBe(200);
    expect(voided.rawPayload.equals(pre.rawPayload)).toBe(false);
  });
});

describe('DELETE /v1/me', () => {
  it('soft-deletes: 204, all sessions and push subscriptions revoked at once, claims kept for the 30 days, audit entry without the user id', async () => {
    const u = await loginUser(w);
    // a second session of the same user (another device)
    await buyerCall(w, 'POST', '/v1/auth/email/start', { body: { email: u.email } });
    const second = await buyerCall(w, 'POST', '/v1/auth/email/verify', { body: { email: u.email, code: w.codes[u.email] } });
    const token2 = (second.body as { token: string }).token;
    const r = await createReceipt(w, w.orgA, { state: 'paid' });
    await claimRequest(w, u, r);
    await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint: 'https://push.example.test/del', keys } });

    const del = await buyerCall(w, 'DELETE', '/v1/me', { token: u.token });
    expect(del.status).toBe(204);
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: u.token })).status).toBe(401);
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: token2 })).status).toBe(401);
    expect(await sql(w, 'select 1 from buyer.sessions where user_id = $1', [u.userId])).toHaveLength(0);
    expect(await sql(w, 'select 1 from buyer.push_subscriptions where user_id = $1', [u.userId])).toHaveLength(0);
    expect((await sql<{ d: boolean }>(w, 'select deleted_at is not null d from buyer.users where id = $1', [u.userId]))[0]?.d).toBe(true);
    // not hard-deleted yet
    expect(await sql(w, 'select 1 from buyer.claims where user_id = $1', [u.userId])).toHaveLength(1);
    const audit = await sql<{ row: string }>(w, "select row_to_json(a)::text row from ops.audit_log a where event = 'account_deleted'");
    expect(audit.length).toBeGreaterThan(0);
    for (const a of audit) {
      expect(a.row).not.toContain(u.userId);
      expect(a.row).not.toContain(u.email);
    }
    expect((await buyerCall(w, 'DELETE', '/v1/me', { token: u.token })).status).toBe(401);
  });
});
