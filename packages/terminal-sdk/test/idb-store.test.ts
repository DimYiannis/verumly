import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPair } from '@lr/crypto';
import { IndexedDbStore } from '../src/idb-store.ts';
import { MemoryStore, TerminalSdk, type OutboxStore } from '../src/index.ts';

const stores: Array<[string, () => OutboxStore]> = [
  ['MemoryStore', () => new MemoryStore()],
  ['IndexedDbStore', () => new IndexedDbStore(`t-${Math.random()}`)],
];

const crf = (receiptId: string, version: number) => ({ receiptId, version }) as never;
const item = (receiptId: string, version: number) => ({
  receiptId,
  version,
  idempotencyKey: `${receiptId}:${version}`,
  body: { version: crf(receiptId, version), signature: `sig-${version}` },
});

describe.each(stores)('OutboxStore contract: %s', (_name, make) => {
  let s: OutboxStore;
  beforeEach(() => {
    s = make();
  });

  it('commits receipt state and outbox item together; pending is oldest-first with increasing seq', async () => {
    await s.commit({ receiptId: 'a', secret: 'sa', crf: crf('a', 1) }, item('a', 1));
    await s.commit({ receiptId: 'b', secret: 'sb', crf: crf('b', 1) }, item('b', 1));
    await s.commit({ receiptId: 'a', secret: 'sa', crf: crf('a', 2) }, item('a', 2));
    expect((await s.getReceipt('a'))?.crf).toMatchObject({ version: 2 });
    expect((await s.getReceipt('a'))?.secret).toBe('sa');
    expect(await s.getReceipt('zzz')).toBeUndefined();
    const p = await s.pending(10);
    expect(p.map((i) => `${i.receiptId}${i.version}`)).toEqual(['a1', 'b1', 'a2']);
    expect(p.map((i) => i.seq)).toEqual([...p.map((i) => i.seq)].sort((x, y) => x - y));
    expect(new Set(p.map((i) => i.seq)).size).toBe(3);
    expect((await s.pending(2)).length).toBe(2);
    expect(p[0]).toMatchObject({ idempotencyKey: 'a:1', body: { signature: 'sig-1' } });
  });

  it('remove, reject (dead-letter) and pendingAfter', async () => {
    for (const v of [1, 2, 3]) await s.commit({ receiptId: 'a', secret: 's', crf: crf('a', v) }, item('a', v));
    await s.commit({ receiptId: 'b', secret: 's', crf: crf('b', 1) }, item('b', 1));
    const [a1, a2, a3, b1] = await s.pending(10);
    expect((await s.pendingAfter('a', 1)).map((i) => i.version)).toEqual([2, 3]);
    expect(await s.pendingAfter('a', 3)).toEqual([]);
    await s.remove([a1!.seq]);
    await s.reject([a2!.seq, a3!.seq], '422 invalid');
    expect(await s.stats()).toEqual({ pending: 1, rejected: 2 });
    expect((await s.pending(10)).map((i) => i.seq)).toEqual([b1!.seq]);
    await s.reject([9999], 'unknown seq is ignored');
    expect(await s.stats()).toEqual({ pending: 1, rejected: 2 });
  });
});

describe('IndexedDbStore specifics', () => {
  it('survives reopening the database (a reload of the simulator tab)', async () => {
    const name = `persist-${Date.now()}`;
    const first = new IndexedDbStore(name);
    await first.commit({ receiptId: 'a', secret: 's', crf: crf('a', 1) }, item('a', 1));
    await first.close();
    const second = new IndexedDbStore(name);
    expect((await second.pending(10)).map((i) => i.idempotencyKey)).toEqual(['a:1']);
    expect((await second.getReceipt('a'))?.secret).toBe('s');
    // seq keeps increasing after reopen
    await second.commit({ receiptId: 'a', secret: 's', crf: crf('a', 2) }, item('a', 2));
    const seqs = (await second.pending(10)).map((i) => i.seq);
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
  });

  it('is atomic: a failing commit leaves neither the receipt nor the outbox item', async () => {
    const s = new IndexedDbStore(`atomic-${Date.now()}`);
    // a function cannot be structured-cloned, so the outbox add throws after the receipt put was queued
    const bad = { ...item('a', 1), body: { version: crf('a', 1), signature: () => 1 } as never };
    await expect(s.commit({ receiptId: 'a', secret: 's', crf: crf('a', 1) }, bad)).rejects.toThrow();
    expect(await s.getReceipt('a')).toBeUndefined();
    expect(await s.stats()).toEqual({ pending: 0, rejected: 0 });
  });

  it('backs a real TerminalSdk: queue offline, flush in order when the API returns', async () => {
    const keys = generateKeyPair();
    const store = new IndexedDbStore(`sdk-${Date.now()}`);
    const calls: string[] = [];
    let online = false;
    const sdk = new TerminalSdk({
      apiBase: 'http://api.test',
      receiptHost: 'http://localhost:3001',
      terminalId: '0190a000-0000-7000-8000-000000000001',
      apiKey: 'k',
      privateKey: keys.privateKey,
      merchant: { kvkNumber: '12345678', vatNumber: null, name: 'Café', locationId: '0190a000-0000-7000-8000-000000000002' },
      store,
      fetch: async (input, init) => {
        if (!online) throw new TypeError('offline');
        calls.push(`${String(init?.method)} ${String(input)}`);
        const body: unknown = JSON.parse(String(init?.body));
        const n = typeof body === 'object' && body !== null && 'items' in body && Array.isArray(body.items) ? body.items.length : 0;
        return Response.json({ results: Array.from({ length: n }, () => ({ status: 'created' })) });
      },
    });
    const { receiptId, qrUrl } = await sdk.createReceipt({ state: 'presented', lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9 }] });
    await sdk.addVersion(receiptId, { state: 'paid', payments: [{ method: 'cash' }] });
    expect(qrUrl).toContain(`/r/${receiptId}#`);
    expect((await sdk.flush()).retry).toBe(true);
    expect((await store.stats()).pending).toBe(2);
    online = true;
    expect(await sdk.flush()).toEqual({ sent: 2, rejected: 0, retry: false });
    expect(calls).toEqual(['POST http://api.test/v1/receipts:batch']);
    expect((await store.stats()).pending).toBe(0);
  });
});
