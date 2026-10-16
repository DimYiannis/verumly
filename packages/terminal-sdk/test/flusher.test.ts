import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore, type OutboxStore } from '../src/index.ts';
import { SqliteStore } from '../src/sqlite-store.ts';
import { fakeServer, sdkFor, simpleDraft } from './support.ts';

async function queueReceipts(sdk: ReturnType<typeof sdkFor>, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await sdk.createReceipt(simpleDraft)).receiptId);
  return ids;
}

describe('ordered flusher: single upload vs batch', () => {
  it('one pending item → the single endpoint, with the stable Idempotency-Key and a request signature', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    const { receiptId } = await sdk.createReceipt(simpleDraft);
    expect(await sdk.flush()).toEqual({ sent: 1, rejected: 0, retry: false });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ path: '/v1/receipts', keys: [`${receiptId}:1`] });
    expect(server.requests[0]?.headers['idempotency-key']).toBe(`${receiptId}:1`);
    expect(server.requests[0]?.headers['x-signature']).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(server.requests[0]?.headers.authorization).toMatch(/^Bearer k+$/);
  });

  it('a single later version goes to /v1/receipts/:id/versions', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    const { receiptId } = await sdk.createReceipt(simpleDraft);
    await sdk.flush();
    await sdk.addVersion(receiptId, { state: 'paid' });
    await sdk.flush();
    expect(server.requests.map((r) => r.path)).toEqual(['/v1/receipts', `/v1/receipts/${receiptId}/versions`]);
  });

  it('more than one pending item → one POST /v1/receipts:batch, items in commit order, no Idempotency-Key header', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    const ids = await queueReceipts(sdk, 3);
    expect(await sdk.flush()).toEqual({ sent: 3, rejected: 0, retry: false });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.path).toBe('/v1/receipts:batch');
    expect(server.requests[0]?.items).toEqual(ids.map((id) => `${id}:1`));
    expect(server.requests[0]?.headers['idempotency-key']).toBeUndefined();
    expect(server.requests[0]?.keys).toEqual(ids.map((id) => `${id}:1`));
  });

  it('1200 pending items → exactly 3 requests of 500, 500 and 200, in order', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    const ids = await queueReceipts(sdk, 1200);
    const result = await sdk.flush();
    expect(result).toEqual({ sent: 1200, rejected: 0, retry: false });
    expect(server.requests.map((r) => r.items.length)).toEqual([500, 500, 200]);
    expect(server.requests.every((r) => r.path === '/v1/receipts:batch')).toBe(true);
    expect(server.requests.flatMap((r) => r.items)).toEqual(ids.map((id) => `${id}:1`));
    expect(server.accepted).toEqual(ids.map((id) => `${id}:1`));
  });

  it('a configured batchSize above 500 is clamped to 500; a smaller one is used', async () => {
    const big = fakeServer();
    const sdkBig = sdkFor(new MemoryStore(), { fetch: big.fetch, batchSize: 5000 });
    await queueReceipts(sdkBig, 501);
    await sdkBig.flush();
    expect(big.requests.map((r) => r.items.length)).toEqual([500, 1]);

    const small = fakeServer();
    const sdkSmall = sdkFor(new MemoryStore(), { fetch: small.fetch, batchSize: 4 });
    await queueReceipts(sdkSmall, 10);
    await sdkSmall.flush();
    expect(small.requests.map((r) => r.items.length)).toEqual([4, 4, 2]);
  });

  it('versions of one receipt and of other receipts are sent strictly in commit order', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    const a = (await sdk.createReceipt(simpleDraft)).receiptId;
    const b = (await sdk.createReceipt(simpleDraft)).receiptId;
    await sdk.addVersion(a, { state: 'presented' });
    await sdk.addVersion(b, { state: 'paid' });
    await sdk.addVersion(a, { state: 'paid' });
    await sdk.flush();
    expect(server.accepted).toEqual([`${a}:1`, `${b}:1`, `${a}:2`, `${b}:2`, `${a}:3`]);
  });

  it('a nothing-to-do flush makes no request', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    expect(await sdk.flush()).toEqual({ sent: 0, rejected: 0, retry: false });
    expect(server.requests).toHaveLength(0);
  });

  it('passes never overlap: two concurrent flush() calls share one pass', async () => {
    const server = fakeServer();
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    await queueReceipts(sdk, 4);
    const [x, y] = await Promise.all([sdk.flush(), sdk.flush()]);
    expect(x).toEqual(y);
    expect(server.requests).toHaveLength(1);
  });
});

describe('retries keep the same Idempotency-Key and bytes', () => {
  it('network failure: nothing is removed, retry=true; the retry sends identical bodies, keys and signatures', async () => {
    const server = fakeServer({ request: (n) => (n === 1 ? 'network' : undefined) });
    const store = new MemoryStore();
    const sdk = sdkFor(store, { fetch: server.fetch });
    await queueReceipts(sdk, 3);
    expect(await sdk.flush()).toEqual({ sent: 0, rejected: 0, retry: true });
    expect(await store.stats()).toEqual({ pending: 3, rejected: 0 });
    expect(await sdk.flush()).toEqual({ sent: 3, rejected: 0, retry: false });
    expect(server.requests[1]?.text).toBe(server.requests[0]?.text);
    expect(server.requests[1]?.headers['x-signature']).toBe(server.requests[0]?.headers['x-signature']);
    expect(server.requests[1]?.keys).toEqual(server.requests[0]?.keys);
  });

  it.each([500, 502, 503, 429, 408])('HTTP %i is retryable: items stay queued, nothing is dead-lettered', async (status) => {
    const server = fakeServer({ request: (n) => (n === 1 ? status : undefined) });
    const store = new MemoryStore();
    const sdk = sdkFor(store, { fetch: server.fetch });
    await queueReceipts(sdk, 2);
    expect(await sdk.flush()).toEqual({ sent: 0, rejected: 0, retry: true });
    expect(await store.stats()).toEqual({ pending: 2, rejected: 0 });
    expect((await sdk.flush()).sent).toBe(2);
  });

  it('single-item 5xx is retryable too', async () => {
    const server = fakeServer({ request: (n) => (n === 1 ? 503 : undefined) });
    const store = new MemoryStore();
    const sdk = sdkFor(store, { fetch: server.fetch });
    await sdk.createReceipt(simpleDraft);
    expect(await sdk.flush()).toEqual({ sent: 0, rejected: 0, retry: true });
    expect(await sdk.flush()).toEqual({ sent: 1, rejected: 0, retry: false });
  });

  it('a lost acknowledgement (server stored the batch, the response never arrived) is resent and replayed, not duplicated', async () => {
    const server = fakeServer({ loseAck: (n) => n === 1 });
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch });
    const ids = await queueReceipts(sdk, 5);
    expect((await sdk.flush()).retry).toBe(true);
    expect(server.accepted).toHaveLength(5);
    expect(await sdk.flush()).toEqual({ sent: 5, rejected: 0, retry: false });
    expect(server.accepted).toEqual(ids.map((id) => `${id}:1`));
  });

  it('version_gap is retryable (the missing version is on its way), not dead-lettered', async () => {
    const server = fakeServer();
    const store = new MemoryStore();
    const sdk = sdkFor(store, { fetch: server.fetch });
    const { receiptId } = await sdk.createReceipt(simpleDraft);
    await sdk.addVersion(receiptId, { state: 'paid' });
    // the server lost v1 (e.g. restored from a backup): v2 alone → version_gap
    const [v1] = await store.pending(1);
    await store.remove([v1!.seq]);
    const r = await sdk.flush();
    expect(r).toMatchObject({ sent: 0, rejected: 0, retry: true });
    expect(await store.stats()).toEqual({ pending: 1, rejected: 0 });
  });
});

describe('non-retryable rejections dead-letter the item and every later version of that receipt', () => {
  const scenario = async (mode: 'batch' | 'single') => {
    const store = new MemoryStore();
    let badId = '';
    const server = fakeServer({ reject: (i) => (i.receiptId === badId && i.version === 1 ? { httpStatus: 422, error: 'invalid_receipt' } : undefined) });
    const sdk = sdkFor(store, { fetch: server.fetch });
    const bad = (await sdk.createReceipt(simpleDraft)).receiptId;
    badId = bad;
    if (mode === 'single') {
      // flush the head alone so the single endpoint is used
      expect(await sdk.flush()).toMatchObject({ sent: 0, rejected: 1 });
      return { server, store, sdk, bad, good: '' };
    }
    const good = (await sdk.createReceipt(simpleDraft)).receiptId;
    await sdk.addVersion(bad, { state: 'presented' });
    await sdk.addVersion(bad, { state: 'paid' });
    await sdk.addVersion(good, { state: 'paid' });
    return { server, store, sdk, bad, good };
  };

  it('batch: the rejected v1 takes v2 and v3 of the same receipt with it; other receipts continue', async () => {
    const { server, store, sdk, bad, good } = await scenario('batch');
    const r = await sdk.flush();
    expect(r.rejected).toBe(3);
    expect(await store.stats()).toEqual({ pending: 0, rejected: 3 });
    expect(server.accepted).toEqual([`${good}:1`, `${good}:2`]);
    expect(server.accepted.some((a) => a.startsWith(bad))).toBe(false);
  });

  it('single endpoint: 422 on the only pending item dead-letters it', async () => {
    const { store } = await scenario('single');
    expect(await store.stats()).toEqual({ pending: 0, rejected: 1 });
  });

  it('single endpoint: the later versions queued behind it are cascaded too', async () => {
    const store = new MemoryStore();
    let bad = '';
    const server = fakeServer({ reject: (i) => (i.receiptId === bad && i.version === 1 ? { httpStatus: 422, error: 'invalid_receipt' } : undefined) });
    const sdk = sdkFor(store, { fetch: server.fetch, batchSize: 1 }); // batchSize 1 forces the single endpoint for each item
    bad = (await sdk.createReceipt(simpleDraft)).receiptId;
    await sdk.addVersion(bad, { state: 'presented' });
    await sdk.addVersion(bad, { state: 'paid' });
    const other = (await sdk.createReceipt(simpleDraft)).receiptId;
    const r = await sdk.flush();
    expect(r).toMatchObject({ sent: 1, rejected: 3, retry: false });
    expect(server.accepted).toEqual([`${other}:1`]);
    expect(server.requests.every((q) => q.path !== '/v1/receipts:batch')).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])('a per-item HTTP %i (other than version_gap) is non-retryable', async (httpStatus) => {
    const store = new MemoryStore();
    const server = fakeServer({ reject: () => ({ httpStatus, error: httpStatus === 409 ? 'idempotency_conflict' : 'nope' }) });
    const sdk = sdkFor(store, { fetch: server.fetch });
    await queueReceipts(sdk, 2);
    const r = await sdk.flush();
    expect(r).toMatchObject({ sent: 0, rejected: 2 });
    expect(await store.stats()).toEqual({ pending: 0, rejected: 2 });
  });
});

describe('whole-batch rejections must not block the queue forever', () => {
  it('a whole batch answered 401 (revoked or rotated key) is dead-lettered like single uploads are, not retried for ever', async () => {
    const store = new MemoryStore();
    const server = fakeServer({ request: () => 401 });
    const sdk = sdkFor(store, { fetch: server.fetch });
    await queueReceipts(sdk, 4);
    const r = await sdk.flush();
    expect(r.rejected).toBe(4);
    expect(await store.stats()).toEqual({ pending: 0, rejected: 4 });
  });

  it('a whole batch answered 400 because ONE item is malformed: the malformed item is isolated, the good ones are delivered', async () => {
    const store = new MemoryStore();
    let poison = '';
    const server = fakeServer({
      // a batch containing the poison item is refused as a whole (schema validation), singles are judged individually
      request: (_n, path) => (path.endsWith('batch') && poison ? 400 : undefined),
      reject: (i) => (i.receiptId === poison ? { httpStatus: 400, error: 'validation' } : undefined),
    });
    const sdk = sdkFor(store, { fetch: server.fetch });
    const ids = await queueReceipts(sdk, 3);
    poison = ids[1]!;
    const r = await sdk.flush();
    expect(r).toMatchObject({ sent: 2, rejected: 1 });
    expect(server.accepted).toEqual([`${ids[0]}:1`, `${ids[2]}:1`]);
    expect(await store.stats()).toEqual({ pending: 0, rejected: 1 });
  });

  it('a transient failure during the item-by-item fallback keeps the rest queued', async () => {
    const store = new MemoryStore();
    const server = fakeServer({ request: (n, path) => (path.endsWith('batch') ? 400 : n === 3 ? 503 : undefined) });
    const sdk = sdkFor(store, { fetch: server.fetch });
    await queueReceipts(sdk, 4);
    const r = await sdk.flush();
    expect(r).toMatchObject({ sent: 1, retry: true });
    expect(await store.stats()).toEqual({ pending: 3, rejected: 0 });
  });
});

describe('failure injection: random drops, lost acks and 5xx never lose, duplicate or reorder a version', () => {
  // deterministic xorshift so a failure is reproducible
  const rng = (seed: number) => () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 10_000) / 10_000;
  };

  it.each([1, 7, 42, 2024])('seed %i: 40 receipts × up to 4 versions, flaky transport', async (seed) => {
    const rand = rng(seed);
    const server = fakeServer({
      request: () => {
        const x = rand();
        return x < 0.15 ? 'network' : x < 0.25 ? 503 : undefined;
      },
      loseAck: () => rand() < 0.15,
    });
    const store = new MemoryStore();
    const sdk = sdkFor(store, { fetch: server.fetch, batchSize: 7 });
    const expected: string[] = [];
    const ids: string[] = [];
    const count: Record<string, number> = {};
    for (let i = 0; i < 40; i++) {
      const { receiptId } = await sdk.createReceipt(simpleDraft);
      ids.push(receiptId);
      count[receiptId] = 1;
      expected.push(`${receiptId}:1`);
    }
    for (let round = 2; round <= 4; round++) {
      for (const id of ids) {
        if (rand() < 0.6) {
          await sdk.addVersion(id, { state: round === 4 ? 'paid' : 'presented' });
          expected.push(`${id}:${(count[id] = (count[id] ?? 1) + 1)}`);
        }
      }
      // interleave uploads with the queueing, like a real till
      await sdk.flush();
    }
    for (let i = 0; i < 400 && (await store.stats()).pending > 0; i++) await sdk.flush();

    expect(await store.stats()).toEqual({ pending: 0, rejected: 0 });
    // each (receiptId, version) accepted exactly once, and the server saw every receipt's versions in order
    expect(new Set(server.accepted).size).toBe(server.accepted.length);
    expect([...server.accepted].sort()).toEqual([...expected].sort());
    for (const id of ids) {
      const versions = server.accepted.filter((a) => a.startsWith(id)).map((a) => Number(a.split(':')[1]));
      expect(versions).toEqual(versions.map((_, i) => i + 1));
    }
  });
});

describe('SQLite outbox through the flusher', () => {
  it('queued while offline, the app restarts (store reopened), the new SDK instance delivers everything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lr-restart-'));
    try {
      const file = join(dir, 'outbox.db');
      const offline = fakeServer({ request: () => 'network' });
      const first = new SqliteStore(file);
      const sdk1 = sdkFor(first, { fetch: offline.fetch });
      const ids = await queueReceipts(sdk1, 5);
      await sdk1.addVersion(ids[0]!, { state: 'paid' });
      expect((await sdk1.flush()).retry).toBe(true);
      first.close();

      const online = fakeServer();
      const reopened: OutboxStore = new SqliteStore(file);
      // same terminal identity as sdk1 is not needed for delivery order; reuse the store only
      const sdk2 = sdkFor(reopened, { fetch: online.fetch });
      expect(await sdk2.flush()).toEqual({ sent: 6, rejected: 0, retry: false });
      expect(online.accepted).toEqual([...ids.map((id) => `${id}:1`), `${ids[0]}:2`]);
      expect(await reopened.stats()).toEqual({ pending: 0, rejected: 0 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
