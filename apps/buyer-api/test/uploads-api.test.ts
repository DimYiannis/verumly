import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, s3EnvSchema } from '@lr/config';
import { createObjectStore } from '@lr/storage';
import { buyerCall, createWorld, loginUser, sql, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
let noStorage: World;
beforeAll(async () => {
  w = await createWorld({ buyerDeps: { s3: createObjectStore(loadEnv(s3EnvSchema)) } });
  noStorage = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
  await noStorage.close();
});

describe('upload endpoints: validation and guards', () => {
  it('POST /v1/me/uploads returns an id, a presigned PUT URL and the header to send; the row starts as pending_upload', async () => {
    const u = await loginUser(w);
    const res = await buyerCall(w, 'POST', '/v1/me/uploads', { token: u.token, body: { contentType: 'image/jpeg', size: 123_456 } });
    expect(res.status).toBe(201);
    const body = res.body as { uploadId: string; uploadUrl: string; headers: Record<string, string> };
    expect(body.headers).toEqual({ 'content-type': 'image/jpeg' });
    const url = new URL(body.uploadUrl);
    expect(url.pathname).toBe(`/receipts/uploads/${u.userId}/${body.uploadId}`);
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('content-length');
    expect(await sql(w, "select status from buyer.uploads where id = $1 and status = 'pending_upload'", [body.uploadId])).toHaveLength(1);
  });

  it('without object storage configured the endpoints answer 503, not 500', async () => {
    const u = await loginUser(noStorage);
    expect((await buyerCall(noStorage, 'POST', '/v1/me/uploads', { token: u.token, body: { contentType: 'image/png', size: 10 } })).status).toBe(503);
    expect((await buyerCall(noStorage, 'POST', '/v1/me/uploads/0190a0a0-0000-7000-8000-000000000000/complete', { token: u.token })).status).toBe(503);
  });

  it('strict body validation: unknown fields, bad types, zero or fractional size', async () => {
    const u = await loginUser(w);
    const post = (body: unknown) => buyerCall(w, 'POST', '/v1/me/uploads', { token: u.token, body });
    expect((await post({ contentType: 'image/png', size: 0 })).status).toBe(400);
    expect((await post({ contentType: 'image/png', size: 1.5 })).status).toBe(400);
    expect((await post({ contentType: 'image/png', size: 5, extra: 1 })).status).toBe(400);
    expect((await post({ contentType: 'application/x-msdownload', size: 5 })).status).toBe(400);
    expect((await post({ contentType: 'application/pdf', size: 5 })).status).toBe(201);
  });

  it('unknown ids, malformed ids, no session and other users’ uploads', async () => {
    const u = await loginUser(w);
    const ghost = '0190a0a0-0000-7000-8000-000000000000';
    expect((await buyerCall(w, 'GET', `/v1/me/uploads/${ghost}`, { token: u.token })).status).toBe(404);
    expect((await buyerCall(w, 'GET', '/v1/me/uploads/not-a-uuid', { token: u.token })).status).toBe(400);
    expect((await buyerCall(w, 'GET', `/v1/me/uploads/${ghost}`)).status).toBe(401);
    expect((await buyerCall(w, 'POST', `/v1/me/uploads/${ghost}/accept-match`, { token: u.token })).status).toBe(404);
  });

  it('GET /v1/me/uploads lists only my uploads, newest first', async () => {
    const a = await loginUser(w);
    const b = await loginUser(w);
    const first = (await buyerCall(w, 'POST', '/v1/me/uploads', { token: a.token, body: { contentType: 'image/png', size: 10 } })).body as { uploadId: string };
    const second = (await buyerCall(w, 'POST', '/v1/me/uploads', { token: a.token, body: { contentType: 'image/png', size: 10 } })).body as { uploadId: string };
    await buyerCall(w, 'POST', '/v1/me/uploads', { token: b.token, body: { contentType: 'image/png', size: 10 } });
    const list = (await buyerCall(w, 'GET', '/v1/me/uploads', { token: a.token })).body as { items: Array<{ uploadId: string; status: string }> };
    expect(list.items.map((i) => i.uploadId)).toEqual([second.uploadId, first.uploadId]);
    expect(list.items[0]?.status).toBe('pending_upload');
  });

  it('accept-match without a match is 409 and PATCH on a non-reviewable upload is 409', async () => {
    const u = await loginUser(w);
    const { uploadId } = (await buyerCall(w, 'POST', '/v1/me/uploads', { token: u.token, body: { contentType: 'image/png', size: 10 } })).body as { uploadId: string };
    expect((await buyerCall(w, 'POST', `/v1/me/uploads/${uploadId}/accept-match`, { token: u.token })).status).toBe(409);
    expect((await buyerCall(w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: u.token, body: { gross: 100 } })).status).toBe(409);
    expect((await buyerCall(w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: u.token, body: {} })).status).toBe(400);
    expect((await buyerCall(w, 'PATCH', `/v1/me/uploads/${uploadId}`, { token: u.token, body: { gross: 'x' } })).status).toBe(400);
  });

  it('at most 50 upload requests per user per hour', async () => {
    const u = await loginUser(w);
    await sql(w, "insert into buyer.uploads (user_id, s3_key, content_type) select $1, 'k' || g, 'image/png' from generate_series(1, 50) g", [u.userId]);
    const res = await buyerCall(w, 'POST', '/v1/me/uploads', { token: u.token, body: { contentType: 'image/png', size: 10 } });
    expect(res.status).toBe(429);
  });

  it('a body-less POST that still sends content-type: application/json is not a 400 (browsers do this); malformed JSON still is', async () => {
    const u = await loginUser(w);
    const ghost = '0190a0a0-0000-7000-8000-000000000000';
    const headers = { authorization: `Bearer ${u.token}`, 'content-type': 'application/json' };
    expect((await w.buyer.inject({ method: 'POST', url: `/v1/me/uploads/${ghost}/complete`, headers })).statusCode).toBe(404);
    expect((await w.buyer.inject({ method: 'POST', url: '/v1/me/uploads', headers, payload: '{nope' })).statusCode).toBe(400);
    expect((await w.buyer.inject({ method: 'DELETE', url: '/v1/me', headers })).statusCode).toBe(204);
  });
});
