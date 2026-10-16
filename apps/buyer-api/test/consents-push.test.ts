import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, createWorld, loginUser, sql, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld({ buyerDeps: { vapidPublicKey: 'BPublicKeyForTests', allowLoopbackPush: true, policyVersion: '2026-10-test' } });
}, 120_000);
afterAll(async () => {
  await w.close();
});

const keys = { p256dh: 'P'.repeat(87), auth: 'A'.repeat(22) };

describe('PUT/GET /v1/me/consents', () => {
  it('all consents default to off; PUT appends rows carrying the policy version; GET returns the latest per purpose', async () => {
    const u = await loginUser(w);
    expect((await buyerCall(w, 'GET', '/v1/me/consents', { token: u.token })).body).toEqual({ consents: { analytics: false, marketing: false, push: false } });

    const put = await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { analytics: true, push: true } });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ consents: { analytics: true, marketing: false, push: true } });
    const later = await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { analytics: false } });
    expect(later.body).toEqual({ consents: { analytics: false, marketing: false, push: true } });

    // append-only history: nothing was updated in place
    const rows = await sql<{ purpose: string; granted: boolean; policy_version: string }>(w, 'select purpose, granted, policy_version from buyer.consents where user_id = $1 order by id', [u.userId]);
    expect(rows).toEqual([
      { purpose: 'analytics', granted: true, policy_version: '2026-10-test' },
      { purpose: 'push', granted: true, policy_version: '2026-10-test' },
      { purpose: 'analytics', granted: false, policy_version: '2026-10-test' },
    ]);
    // an unchanged value adds no row
    await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { push: true } });
    expect(await sql(w, 'select 1 from buyer.consents where user_id = $1', [u.userId])).toHaveLength(3);
  });

  it('rejects an empty body, unknown purposes and non-booleans; requires a session; is per user', async () => {
    const u = await loginUser(w);
    const other = await loginUser(w);
    expect((await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: {} })).status).toBe(400);
    expect((await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { ads: true } })).status).toBe(400);
    expect((await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { push: 'yes' } })).status).toBe(400);
    expect((await buyerCall(w, 'PUT', '/v1/me/consents', { body: { push: true } })).status).toBe(401);
    expect((await buyerCall(w, 'GET', '/v1/me/consents')).status).toBe(401);
    await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { marketing: true } });
    expect((await buyerCall(w, 'GET', '/v1/me/consents', { token: other.token })).body).toEqual({ consents: { analytics: false, marketing: false, push: false } });
  });

  it('the database role cannot rewrite consent history', async () => {
    const u = await loginUser(w);
    await buyerCall(w, 'PUT', '/v1/me/consents', { token: u.token, body: { marketing: true } });
    const { connect } = await import('@lr/db');
    const h = connect('buyer_api', w.testDb.env);
    try {
      await expect(h.pool.query('update buyer.consents set granted = false')).rejects.toThrow(/permission denied/);
      await expect(h.pool.query('delete from buyer.consents')).rejects.toThrow(/permission denied/);
    } finally {
      await h.close();
    }
  });
});

describe('push subscriptions', () => {
  it('serves the public VAPID key without a session', async () => {
    expect((await buyerCall(w, 'GET', '/v1/push/vapid-public-key')).body).toEqual({ publicKey: 'BPublicKeyForTests' });
  });

  it('POST creates (201), the same endpoint again updates (200, same id), DELETE removes (204) and only for the owner', async () => {
    const u = await loginUser(w);
    const other = await loginUser(w);
    const body = { endpoint: 'https://push.example.test/send/abc123', keys };
    const created = await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body });
    expect(created.status).toBe(201);
    const { id } = created.body as { id: string };
    const again = await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { ...body, keys: { p256dh: 'Q'.repeat(87), auth: 'B'.repeat(22) } } });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id });
    expect((await sql<{ p256dh: string }>(w, 'select p256dh from buyer.push_subscriptions where id = $1', [id]))[0]?.p256dh).toBe('Q'.repeat(87));

    expect((await buyerCall(w, 'DELETE', `/v1/me/push-subscriptions/${id}`, { token: other.token })).status).toBe(404);
    expect(await sql(w, 'select 1 from buyer.push_subscriptions where id = $1', [id])).toHaveLength(1);
    expect((await buyerCall(w, 'DELETE', `/v1/me/push-subscriptions/${id}`, { token: u.token })).status).toBe(204);
    expect(await sql(w, 'select 1 from buyer.push_subscriptions where id = $1', [id])).toHaveLength(0);
    expect((await buyerCall(w, 'DELETE', `/v1/me/push-subscriptions/${id}`, { token: u.token })).status).toBe(404);
  });

  it('an endpoint re-registered by another account moves to that account (shared browser)', async () => {
    const a = await loginUser(w);
    const b = await loginUser(w);
    const body = { endpoint: 'https://push.example.test/send/shared', keys };
    const first = await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: a.token, body });
    const second = await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: b.token, body });
    expect(second.status).toBe(200);
    expect(await sql<{ user_id: string }>(w, 'select user_id from buyer.push_subscriptions where id = $1', [(first.body as { id: string }).id])).toEqual([{ user_id: b.userId }]);
  });

  it('the worker POSTs to these URLs, so only https (and loopback http when enabled) is accepted', async () => {
    const u = await loginUser(w);
    const post = (endpoint: string) => buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint, keys } });
    expect((await post('http://push.example.test/x')).status).toBe(422);
    expect((await post('http://10.0.0.5/x')).status).toBe(422);
    expect((await post('http://localhost:9999/x')).status).toBe(201);
    expect((await post('ftp://push.example.test/x')).status).toBe(422);
    expect((await post('not a url')).status).toBe(400);
    expect((await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint: 'https://p.example.test/y', keys: { p256dh: 'short', auth: 'x' } } })).status).toBe(400);
    expect((await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { body: { endpoint: 'https://p.example.test/z', keys } })).status).toBe(401);
  });

  it('loopback http is refused when the app is not in loopback mode (production)', async () => {
    const prod = await createWorld({ buyerDeps: { allowLoopbackPush: false } });
    try {
      const u = await loginUser(prod);
      const res = await buyerCall(prod, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint: 'http://127.0.0.1:9/x', keys } });
      expect(res.status).toBe(422);
      expect((await buyerCall(prod, 'GET', '/v1/push/vapid-public-key')).body).toEqual({ publicKey: null });
    } finally {
      await prod.close();
    }
  }, 60_000);

  it('at most 10 subscriptions per user', async () => {
    const u = await loginUser(w);
    for (let i = 0; i < 10; i++) {
      expect((await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint: `https://push.example.test/many/${i}`, keys } })).status).toBe(201);
    }
    const res = await buyerCall(w, 'POST', '/v1/me/push-subscriptions', { token: u.token, body: { endpoint: 'https://push.example.test/many/11', keys } });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'too_many_subscriptions' });
  });
});
