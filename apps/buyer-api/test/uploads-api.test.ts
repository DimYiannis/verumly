import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv, s3EnvSchema } from '@lr/config';
import { createObjectStore } from '@lr/storage';
import { buyerCall, createWorld, loginUser, sql, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
let noStorage: World;
const s3 = createObjectStore(loadEnv(s3EnvSchema));
beforeAll(async () => {
  w = await createWorld({ buyerDeps: { s3 } });
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
    expect((await post({ contentType: 'image/webp', size: 5 })).status).toBe(201);
    expect((await post({ contentType: 'image/jpeg', size: 5 })).status).toBe(201);
  });

  it('PDF and HEIC are refused: only JPEG, PNG and WEBP are accepted, and no upload row is created', async () => {
    const u = await loginUser(w);
    for (const contentType of ['application/pdf', 'image/heic', 'image/heif', 'image/gif', 'text/html']) {
      const res = await buyerCall(w, 'POST', '/v1/me/uploads', { token: u.token, body: { contentType, size: 5 } });
      expect(res.status, contentType).toBe(400);
    }
    expect(await sql(w, 'select 1 from buyer.uploads where user_id = $1', [u.userId])).toHaveLength(0);
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

const parsed = (lines: Array<Record<string, unknown>>) => ({
  status: 'done',
  failures: [],
  merchant: { name: 'Supermarkt X', kvkNumber: null, vatNumber: null, postcode: null },
  merchantKey: 'name:supermarkt x|',
  printedAtUtc: '2026-09-10T12:00:00.000Z',
  lines,
  gross: lines.reduce((sum, l) => sum + Number(l.total), 0),
  rounding: 0,
  vatBreakdown: [{ rate: 9, base: 1376, vat: 124 }],
  paymentMethod: 'card',
});
const line = (description: string, total: number, extra: Record<string, unknown> = {}) => ({ description, qty: '1', unitPrice: total, total, vatRate: 9, kind: 'item', ...extra });

async function seedUpload(userId: string, status: string, lines: Array<Record<string, unknown>>, key = `uploads/${userId}/${crypto.randomUUID()}`): Promise<{ id: string; key: string }> {
  const [row] = await sql<{ id: string }>(
    w,
    'insert into buyer.uploads (user_id, s3_key, content_type, status, extracted) values ($1, $2, $3, $4, $5) returning id',
    [userId, key, 'image/png', status, JSON.stringify({ parsed: parsed(lines), failures: [], modelRevision: 'mock', corrected: false })],
  );
  return { id: row!.id, key };
}

describe('DELETE /v1/me/uploads/:id', () => {
  it('removes the row and the S3 object; only the owner may, anyone else gets 404 and nothing is deleted', async () => {
    const owner = await loginUser(w);
    const other = await loginUser(w);
    const up = await seedUpload(owner.userId, 'done', [line('Melk', 129)]);
    await s3.put(up.key, new Uint8Array([1, 2, 3]), 'image/png');

    expect((await buyerCall(w, 'DELETE', `/v1/me/uploads/${up.id}`, { token: other.token })).status).toBe(404);
    expect((await buyerCall(w, 'DELETE', `/v1/me/uploads/${up.id}`)).status).toBe(401);
    expect(await sql(w, 'select 1 from buyer.uploads where id = $1', [up.id])).toHaveLength(1);
    expect(await s3.head(up.key)).toEqual({ size: 3 });

    expect((await buyerCall(w, 'DELETE', `/v1/me/uploads/${up.id}`, { token: owner.token })).status).toBe(204);
    expect(await sql(w, 'select 1 from buyer.uploads where id = $1', [up.id])).toHaveLength(0);
    expect(await s3.head(up.key)).toBeNull();
    expect((await buyerCall(w, 'GET', `/v1/me/uploads/${up.id}`, { token: owner.token })).status).toBe(404);
    expect((await buyerCall(w, 'DELETE', `/v1/me/uploads/${up.id}`, { token: owner.token })).status).toBe(404);
  });

  it('answers 503 without object storage, and deletes nothing', async () => {
    const u = await loginUser(noStorage);
    const [row] = await sql<{ id: string }>(noStorage, "insert into buyer.uploads (user_id, s3_key, content_type, status) values ($1, 'k', 'image/png', 'done') returning id", [u.userId]);
    expect((await buyerCall(noStorage, 'DELETE', `/v1/me/uploads/${row!.id}`, { token: u.token })).status).toBe(503);
    expect(await sql(noStorage, 'select 1 from buyer.uploads where id = $1', [row!.id])).toHaveLength(1);
  });
});

describe('GET /v1/me/uploads/:id/photo', () => {
  it('serves the stored bytes with the stored content type to the owner only', async () => {
    const owner = await loginUser(w);
    const other = await loginUser(w);
    const up = await seedUpload(owner.userId, 'done', [line('Melk', 129)]);
    await s3.put(up.key, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    const res = await w.buyer.inject({ method: 'GET', url: `/v1/me/uploads/${up.id}/photo`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect([...res.rawPayload]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect((await buyerCall(w, 'GET', `/v1/me/uploads/${up.id}/photo`, { token: other.token })).status).toBe(404);
    expect((await buyerCall(w, 'GET', `/v1/me/uploads/${up.id}/photo`)).status).toBe(401);
    await s3.remove(up.key);
    expect((await buyerCall(w, 'GET', `/v1/me/uploads/${up.id}/photo`, { token: owner.token })).status).toBe(404);
  });
});

describe('PUT /v1/me/uploads/:id/categories and the category filter', () => {
  it('stores the buyer’s category per line, resets it with null, and changes nothing else (no re-matching, same status)', async () => {
    const u = await loginUser(w);
    const up = await seedUpload(u.userId, 'done', [line('Halfvolle melk', 129, { category: 'boodschappen', sensitive: false }), line('Artikel', 500, { category: 'overig', sensitive: false })]);
    const put = (body: unknown, token = u.token) => buyerCall(w, 'PUT', `/v1/me/uploads/${up.id}/categories`, { token, body });

    const res = await put({ lines: [{ index: 1, category: 'vervoer' }] });
    expect(res.status).toBe(200);
    const view = res.body as { status: string; draft: { gross: number; lines: Array<{ category: string; sensitive: boolean; userCategory?: string | null }> } };
    expect(view.status).toBe('done');
    expect(view.draft.gross).toBe(629);
    expect(view.draft.lines.map((l) => [l.category, l.sensitive, l.userCategory ?? null])).toEqual([['boodschappen', false, null], ['vervoer', false, 'vervoer']]);

    const reset = (await put({ lines: [{ index: 1, category: null }] })).body as typeof view;
    expect(reset.draft.lines[1]).toMatchObject({ category: 'overig', sensitive: false, userCategory: null }); // the rules decide again: no keyword, unknown shop

    expect((await put({ lines: [{ index: 9, category: 'dining' }] })).status).toBe(400);
    expect((await put({ lines: [{ index: 0, category: 'gezondheid-extra' }] })).status).toBe(400);
    expect((await put({ lines: [] })).status).toBe(400);
    expect((await put({ lines: [{ index: 0, category: 'dining' }] }, (await loginUser(w)).token)).status).toBe(404);
  });

  it('only for done and needs_review uploads', async () => {
    const u = await loginUser(w);
    for (const status of ['processing', 'failed', 'replaced']) {
      const up = await seedUpload(u.userId, status, [line('Melk', 129)]);
      expect((await buyerCall(w, 'PUT', `/v1/me/uploads/${up.id}/categories`, { token: u.token, body: { lines: [{ index: 0, category: 'dining' }] } })).status, status).toBe(409);
    }
    const review = await seedUpload(u.userId, 'needs_review', [line('Melk', 129)]);
    expect((await buyerCall(w, 'PUT', `/v1/me/uploads/${review.id}/categories`, { token: u.token, body: { lines: [{ index: 0, category: 'dining' }] } })).status).toBe(200);
  });

  it('GET /v1/me/uploads?category= lists only my uploads with a line of that stored category', async () => {
    const u = await loginUser(w);
    const other = await loginUser(w);
    const groceries = await seedUpload(u.userId, 'done', [line('Melk', 129, { category: 'boodschappen' })]);
    const mixed = await seedUpload(u.userId, 'done', [line('Melk', 129, { category: 'boodschappen' }), line('Parkeren', 300, { category: 'vervoer' })]);
    await seedUpload(u.userId, 'done', [line('Koffie', 340, { category: 'dining' })]);
    await seedUpload(u.userId, 'done', [line('Legacy', 100)]);
    await seedUpload(other.userId, 'done', [line('Melk', 129, { category: 'boodschappen' })]);
    const list = async (query: string) => ((await buyerCall(w, 'GET', `/v1/me/uploads${query}`, { token: u.token })).body as { items: Array<{ uploadId: string }> }).items.map((i) => i.uploadId);

    expect((await list('')).length).toBe(4);
    expect((await list('?category=boodschappen')).sort()).toEqual([groceries.id, mixed.id].sort());
    expect(await list('?category=vervoer')).toEqual([mixed.id]);
    expect(await list('?category=kleding')).toEqual([]);
  });
});
