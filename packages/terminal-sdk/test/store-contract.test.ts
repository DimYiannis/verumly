import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newReceiptId } from '@lr/crypto';
import type { Crf } from '@lr/schema';
import { MemoryStore, type LocalReceipt, type OutboxItem, type OutboxStore } from '../src/index.ts';
import { SqliteStore } from '../src/sqlite-store.ts';
import { sdkFor, simpleDraft } from './support.ts';

/** A genuinely valid signed CRF (made by the SDK) so the stores see realistic payloads. */
async function realVersion(): Promise<{ receipt: LocalReceipt; item: OutboxItem }> {
  const scratch = new MemoryStore();
  const sdk = sdkFor(scratch);
  const created = await sdk.createReceipt(simpleDraft);
  const [first] = await scratch.pending(1);
  const receipt = await scratch.getReceipt(created.receiptId);
  if (!first || !receipt) throw new Error('fixture');
  const { seq: _seq, ...item } = first;
  return { receipt, item };
}

function next(prev: { receipt: LocalReceipt; item: OutboxItem }, version: number): { receipt: LocalReceipt; item: OutboxItem } {
  const crf: Crf = { ...prev.receipt.crf, version };
  return {
    receipt: { ...prev.receipt, crf },
    item: { receiptId: prev.receipt.receiptId, version, idempotencyKey: `${prev.receipt.receiptId}:${version}`, body: { version: crf, signature: prev.item.body.signature } },
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const impls: Array<{ name: string; make: () => OutboxStore }> = [
  { name: 'MemoryStore', make: () => new MemoryStore() },
  {
    name: 'SqliteStore',
    make: () => {
      const dir = mkdtempSync(join(tmpdir(), 'lr-store-'));
      dirs.push(dir);
      return new SqliteStore(join(dir, 'outbox.db'));
    },
  },
];

describe.each(impls)('OutboxStore contract: $name', ({ make }) => {
  it('commit stores the receipt state and one outbox item; getReceipt returns the latest state', async () => {
    const s = make();
    const v1 = await realVersion();
    await s.commit(v1.receipt, v1.item);
    expect(await s.getReceipt(v1.receipt.receiptId)).toEqual(v1.receipt);
    const pending = await s.pending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ ...v1.item, seq: expect.any(Number) });

    const v2 = next(v1, 2);
    await s.commit(v2.receipt, v2.item);
    expect((await s.getReceipt(v1.receipt.receiptId))?.crf.version).toBe(2);
    expect((await s.pending(10)).map((p) => p.version)).toEqual([1, 2]);
  });

  it('getReceipt of an unknown id is undefined', async () => {
    expect(await make().getReceipt(newReceiptId())).toBeUndefined();
  });

  it('pending is oldest-first with strictly increasing seq and honours the limit', async () => {
    const s = make();
    const base = await realVersion();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const receiptId = newReceiptId();
      ids.push(receiptId);
      await s.commit({ ...base.receipt, receiptId, crf: { ...base.receipt.crf, receiptId } }, { ...base.item, receiptId, idempotencyKey: `${receiptId}:1`, body: { ...base.item.body, version: { ...base.item.body.version, receiptId } } });
    }
    const all = await s.pending(100);
    expect(all.map((p) => p.receiptId)).toEqual(ids);
    expect(all.map((p) => p.seq)).toEqual([...all.map((p) => p.seq)].sort((a, b) => a - b));
    expect(new Set(all.map((p) => p.seq)).size).toBe(7);
    expect((await s.pending(3)).map((p) => p.receiptId)).toEqual(ids.slice(0, 3));
    expect(await s.pending(0)).toEqual([]);
  });

  it('pending returns copies: mutating a result never changes the store', async () => {
    const s = make();
    const v1 = await realVersion();
    await s.commit(v1.receipt, v1.item);
    const [p] = await s.pending(1);
    p!.body.version.totals.gross = 1;
    const again = await s.pending(1);
    expect(again[0]?.body.version.totals.gross).toBe(v1.item.body.version.totals.gross);
    const r = await s.getReceipt(v1.receipt.receiptId);
    r!.crf.totals.gross = 1;
    expect((await s.getReceipt(v1.receipt.receiptId))?.crf.totals.gross).toBe(v1.receipt.crf.totals.gross);
  });

  it('remove drops exactly those items; unknown seqs are ignored', async () => {
    const s = make();
    let prev = await realVersion();
    await s.commit(prev.receipt, prev.item);
    for (const v of [2, 3, 4]) {
      prev = next(prev, v);
      await s.commit(prev.receipt, prev.item);
    }
    const seqs = (await s.pending(10)).map((p) => p.seq);
    await s.remove([seqs[0]!, seqs[2]!, 999_999]);
    expect((await s.pending(10)).map((p) => p.version)).toEqual([2, 4]);
    expect(await s.stats()).toEqual({ pending: 2, rejected: 0 });
  });

  it('reject moves items to the dead-letter list: not pending, counted as rejected', async () => {
    const s = make();
    let prev = await realVersion();
    await s.commit(prev.receipt, prev.item);
    for (const v of [2, 3]) {
      prev = next(prev, v);
      await s.commit(prev.receipt, prev.item);
    }
    const seqs = (await s.pending(10)).map((p) => p.seq);
    await s.reject([seqs[0]!, seqs[1]!], '422 invalid_receipt');
    expect((await s.pending(10)).map((p) => p.version)).toEqual([3]);
    expect(await s.stats()).toEqual({ pending: 1, rejected: 2 });
  });

  it('pendingAfter returns only later versions of that receipt, oldest first', async () => {
    const s = make();
    const a = await realVersion();
    const b = await realVersion();
    await s.commit(a.receipt, a.item);
    await s.commit(b.receipt, b.item);
    let prev = a;
    for (const v of [2, 3, 4]) {
      prev = next(prev, v);
      await s.commit(prev.receipt, prev.item);
    }
    expect((await s.pendingAfter(a.receipt.receiptId, 1)).map((p) => p.version)).toEqual([2, 3, 4]);
    expect((await s.pendingAfter(a.receipt.receiptId, 3)).map((p) => p.version)).toEqual([4]);
    expect(await s.pendingAfter(a.receipt.receiptId, 4)).toEqual([]);
    expect(await s.pendingAfter(b.receipt.receiptId, 1)).toEqual([]);
    expect(await s.pendingAfter(newReceiptId(), 0)).toEqual([]);
  });

  it('an empty store reports zero everywhere', async () => {
    const s = make();
    expect(await s.pending(10)).toEqual([]);
    expect(await s.stats()).toEqual({ pending: 0, rejected: 0 });
  });
});

describe('SqliteStore durability', () => {
  const open = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lr-sqlite-'));
    dirs.push(dir);
    return join(dir, 'outbox.db');
  };

  it('everything survives close and reopen: receipts, pending items (order and seq), dead letters', async () => {
    const file = open();
    const first = new SqliteStore(file);
    let prev = await realVersion();
    await first.commit(prev.receipt, prev.item);
    for (const v of [2, 3, 4]) {
      prev = next(prev, v);
      await first.commit(prev.receipt, prev.item);
    }
    const before = await first.pending(10);
    await first.reject([before[0]!.seq], 'because');
    const pendingBefore = await first.pending(10);
    first.close();

    const second = new SqliteStore(file);
    expect(await second.pending(10)).toEqual(pendingBefore);
    expect(await second.stats()).toEqual({ pending: 3, rejected: 1 });
    expect((await second.getReceipt(prev.receipt.receiptId))?.crf.version).toBe(4);
    second.close();
  });

  it('seq numbers are never reused, even after the outbox has been emptied and reopened', async () => {
    const file = open();
    const s1 = new SqliteStore(file);
    const v1 = await realVersion();
    await s1.commit(v1.receipt, v1.item);
    const [old] = await s1.pending(1);
    await s1.remove([old!.seq]);
    s1.close();
    const s2 = new SqliteStore(file);
    const v2 = next(v1, 2);
    await s2.commit(v2.receipt, v2.item);
    const [fresh] = await s2.pending(1);
    expect(fresh!.seq).toBeGreaterThan(old!.seq);
    s2.close();
  });

  it('commit is atomic: when the outbox insert fails, the receipt state is not updated either', async () => {
    const file = open();
    const s = new SqliteStore(file);
    const v1 = await realVersion();
    await s.commit(v1.receipt, v1.item);
    const v2 = next(v1, 2);
    // a body JSON cannot serialise makes the outbox insert throw after the receipt row was written
    const poisoned: OutboxItem = { ...v2.item, body: { ...v2.item.body, version: Object.assign({}, v2.item.body.version, { poison: 1n }) } };
    await expect(s.commit(v2.receipt, poisoned)).rejects.toThrow();
    expect((await s.getReceipt(v1.receipt.receiptId))?.crf.version).toBe(1);
    expect((await s.pending(10)).map((p) => p.version)).toEqual([1]);
    s.close();
  });

  it('a second connection sees committed rows (WAL) — the crash test relies on this', async () => {
    const file = open();
    const writer = new SqliteStore(file);
    const v1 = await realVersion();
    await writer.commit(v1.receipt, v1.item);
    const reader = new SqliteStore(file);
    expect((await reader.pending(10)).map((p) => p.version)).toEqual([1]);
    reader.close();
    writer.close();
  });
});
