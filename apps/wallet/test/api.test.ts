import { describe, expect, it } from 'vitest';
import { ApiError, createApi, putToStorage } from '../app/utils/api.ts';
import { pollUpload, uploadFile, validateUploadFile } from '../app/utils/uploads.ts';
import type { UploadStatus } from '../app/utils/api-schemas.ts';

const ID = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c40';
const SECRET = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUo';

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(respond: (seen: Seen) => Response | Error) {
  const calls: Seen[] = [];
  const impl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init?.headers ?? {})) headers[k.toLowerCase()] = String(v);
    const seen = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined };
    calls.push(seen);
    const r = respond(seen);
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, impl };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createApi', () => {
  it('resolve/view posts the secret in the body, with no bearer and nothing in the URL', async () => {
    const f = fakeFetch(() => json({ status: 'pending' }));
    const api = createApi({ baseUrl: 'http://api.test', getToken: () => 'tok-abcdefghijklmnopqrstuvwxyz', fetch: f.impl });
    expect(await api.resolveView(ID, SECRET)).toEqual({ status: 'pending' });
    expect(f.calls[0]).toMatchObject({ url: 'http://api.test/v1/resolve/view', method: 'POST', body: JSON.stringify({ receiptId: ID, secret: SECRET }) });
    expect(f.calls[0]?.headers.authorization).toBeUndefined();
    expect(f.calls[0]?.url).not.toContain(SECRET);
  });

  it('sends the bearer token on authenticated calls and builds the filter query', async () => {
    const f = fakeFetch(() => json({ items: [], nextCursor: null }));
    const api = createApi({ baseUrl: 'http://api.test', getToken: () => 'tok-abcdefghijklmnopqrstuvwxyz', fetch: f.impl });
    await api.listReceipts({ q: 'koffie', state: 'paid', from: '2026-10-01', merchant: '', cursor: 'c1' });
    const url = new URL(f.calls[0]!.url);
    expect(url.pathname).toBe('/v1/me/receipts');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'koffie', state: 'paid', from: '2026-10-01', cursor: 'c1' });
    expect(f.calls[0]?.headers.authorization).toBe('Bearer tok-abcdefghijklmnopqrstuvwxyz');
  });

  it('maps HTTP errors and network failures to ApiError', async () => {
    const f = fakeFetch((s) => (s.url.endsWith('/claims') ? json({ error: 'already_claimed' }, 409) : new TypeError('failed to fetch')));
    const api = createApi({ baseUrl: 'http://api.test', getToken: () => null, fetch: f.impl });
    await expect(api.claim(ID, SECRET)).rejects.toMatchObject({ status: 409, code: 'already_claimed', isNetwork: false });
    await expect(api.resolveView(ID, SECRET)).rejects.toMatchObject({ status: 0, isNetwork: true });
  });

  it('claim returns the HTTP status (201 claimed, 200 already_yours)', async () => {
    const f = fakeFetch(() => json({ receiptId: ID, status: 'claimed' }, 201));
    const api = createApi({ baseUrl: 'http://api.test', getToken: () => null, fetch: f.impl });
    expect(await api.claim(ID, SECRET)).toBe(201);
  });

  it('rejects responses that do not match the contract', async () => {
    const f = fakeFetch(() => json({ nope: true }));
    const api = createApi({ baseUrl: 'http://api.test', getToken: () => null, fetch: f.impl });
    await expect(api.getReceipt(ID)).rejects.toThrow();
  });
});

describe('upload management calls', () => {
  const view = { uploadId: 'u1', status: 'done', failures: [], draft: null, matchedReceiptId: null, match: null, createdAt: '2026-10-16T10:00:00Z' };

  it('filters the list by category, sets categories with PUT, fetches the photo with the bearer and deletes', async () => {
    const f = fakeFetch((s) => {
      if (s.method === 'DELETE') return new Response(null, { status: 204 });
      if (s.url.endsWith('/photo')) return new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
      return json(s.url.includes('/uploads?') ? { items: [view] } : view);
    });
    const api = createApi({ baseUrl: 'http://api.test', getToken: () => 'tok-abcdefghijklmnopqrstuvwxyz', fetch: f.impl });
    await api.listUploads({ category: 'boodschappen' });
    expect(f.calls[0]?.url).toBe('http://api.test/v1/me/uploads?category=boodschappen');
    await api.setUploadCategories('u1', [{ index: 0, category: 'vervoer' }, { index: 1, category: null }]);
    expect(f.calls[1]).toMatchObject({ method: 'PUT', url: 'http://api.test/v1/me/uploads/u1/categories' });
    expect(JSON.parse(f.calls[1]?.body ?? '')).toEqual({ lines: [{ index: 0, category: 'vervoer' }, { index: 1, category: null }] });
    expect(await (await api.uploadPhoto('u1')).text()).toBe('png-bytes');
    expect(f.calls[2]?.headers.authorization).toBe('Bearer tok-abcdefghijklmnopqrstuvwxyz');
    await api.deleteUpload('u1');
    expect(f.calls[3]).toMatchObject({ method: 'DELETE', url: 'http://api.test/v1/me/uploads/u1' });
  });
});

describe('uploads', () => {
  it('validates type and size', () => {
    expect(validateUploadFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validateUploadFile({ type: 'image/webp', size: 1000 })).toBeNull();
    // PDF and HEIC are not read by the extractor: refused before anything is uploaded
    expect(validateUploadFile({ type: 'application/pdf', size: 1000 })).toBeNull();
    expect(validateUploadFile({ type: 'image/heic', size: 1000 })).toBe('unsupported_type');
    expect(validateUploadFile({ type: '', size: 1000 })).toBe('unsupported_type');
    expect(validateUploadFile({ type: 'text/plain', size: 1000 })).toBe('unsupported_type');
    expect(validateUploadFile({ type: 'image/png', size: 10_000_001 })).toBe('too_large');
    expect(validateUploadFile({ type: 'image/png', size: 0 })).toBe('empty');
  });

  it('presigns, PUTs the bytes straight to storage (no bearer), then completes', async () => {
    const order: string[] = [];
    const storage = fakeFetch((s) => {
      order.push(`PUT ${s.url}`);
      return new Response(null, { status: 200 });
    });
    const api = {
      async createUpload(type: string, size: number) {
        order.push(`presign ${type} ${size}`);
        return { uploadId: 'u1', uploadUrl: 'http://s3.test/receipts/u1?sig=x', headers: {} };
      },
      async completeUpload(id: string) {
        order.push(`complete ${id}`);
        return { uploadId: id, status: 'processing' };
      },
    };
    const id = await uploadFile(api, new Blob(['abc'], { type: 'image/png' }), storage.impl);
    expect(id).toBe('u1');
    expect(order).toEqual(['presign image/png 3', 'PUT http://s3.test/receipts/u1?sig=x', 'complete u1']);
    expect(storage.calls[0]?.headers).toEqual({ 'content-type': 'image/png' });
  });

  it('never presigns a HEIC file', async () => {
    let presigned = false;
    const api = {
      async createUpload() {
        presigned = true;
        return { uploadId: 'u1', uploadUrl: 'http://s3.test/x', headers: {} };
      },
      completeUpload: async (id: string) => ({ uploadId: id, status: 'processing' }),
    };
    await expect(uploadFile(api, new Blob(['x'], { type: 'image/heic' }))).rejects.toMatchObject({ code: 'unsupported_type' });
    expect(presigned).toBe(false);
  });

  it('does not call complete when the storage PUT fails', async () => {
    let completed = false;
    const storage = fakeFetch(() => new Response(null, { status: 403 }));
    const api = {
      createUpload: async () => ({ uploadId: 'u1', uploadUrl: 'http://s3.test/x', headers: {} }),
      async completeUpload(id: string) {
        completed = true;
        return { uploadId: id, status: 'processing' };
      },
    };
    await expect(uploadFile(api, new Blob(['abc'], { type: 'image/png' }), storage.impl)).rejects.toBeInstanceOf(ApiError);
    expect(completed).toBe(false);
    await expect(putToStorage('http://s3.test/x', {}, new Blob(['a']), fakeFetch(() => new Error('offline')).impl)).rejects.toMatchObject({ isNetwork: true });
  });

  it('polls until the upload settles, and gives up at the timeout', async () => {
    const mk = (status: UploadStatus['status']): UploadStatus => ({ uploadId: 'u1', status, failures: [], draft: null, matchedReceiptId: null, match: null, createdAt: '2026-10-16T10:00:00Z' });
    let t = 0;
    const seq: UploadStatus['status'][] = ['pending_upload', 'processing', 'needs_review'];
    const seen: string[] = [];
    const settled = await pollUpload({
      fetchStatus: async () => mk(seq.shift() ?? 'done'),
      sleep: async (ms) => void (t += ms),
      now: () => t,
      onStatus: (s) => seen.push(s.status),
    });
    expect(settled?.status).toBe('needs_review');
    expect(seen).toEqual(['pending_upload', 'processing', 'needs_review']);

    t = 0;
    const never = await pollUpload({ fetchStatus: async () => mk('processing'), sleep: async (ms) => void (t += ms), now: () => t, timeoutMs: 5_000, intervalMs: 1_000 });
    expect(never).toBeNull();
  });
});
