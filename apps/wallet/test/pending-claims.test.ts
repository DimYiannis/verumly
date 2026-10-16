import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createIdbClaimStorage, openWalletDb } from '../app/utils/idb.ts';
import { createMemoryClaimStorage, createPendingClaimStore, type ClaimStorage } from '../app/utils/pending-claims.ts';

const A = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c40';
const B = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c41';
const S = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUo';

function suite(name: string, makeStorage: () => ClaimStorage) {
  describe(name, () => {
    let clock = 1_000;
    let storage: ClaimStorage;
    const store = () => createPendingClaimStore(storage, () => clock);
    beforeEach(() => {
      clock = 1_000;
      storage = makeStorage();
    });

    it('stores {receiptId, secret, createdAt} and lists oldest first', async () => {
      const s = store();
      await s.add(B, S, true);
      clock = 2_000;
      await s.add(A, S, true);
      const [first, second] = await s.listPending();
      expect(first).toMatchObject({ receiptId: B, secret: S, createdAt: 1_000, status: 'pending', lastAttemptAt: null });
      expect(second?.receiptId).toBe(A);
    });

    it('is idempotent and keeps the original createdAt (the 7 days start at first sighting)', async () => {
      const s = store();
      await s.add(A, S, true);
      clock = 9_999;
      const again = await s.add(A, S, true);
      expect(again.createdAt).toBe(1_000);
      expect(await s.listPending()).toHaveLength(1);
    });

    it('upgrades a parked claim to auto but never downgrades', async () => {
      const s = store();
      expect((await s.add(A, S, false)).autoClaim).toBe(false);
      expect((await s.add(A, S, true)).autoClaim).toBe(true);
      expect((await s.add(A, S, false)).autoClaim).toBe(true);
    });

    it('records attempts and removes', async () => {
      const s = store();
      await s.add(A, S, true);
      await s.markAttempt(A, 5_000);
      expect((await s.listPending())[0]?.lastAttemptAt).toBe(5_000);
      await s.remove(A);
      expect(await s.listPending()).toEqual([]);
      expect(await s.get(A)).toBeUndefined();
    });

    it('close() drops the secret and keeps a record with the reason', async () => {
      const s = store();
      await s.add(A, S, true);
      const closed = await s.close(A, 'expired', 7_000);
      expect(closed).toEqual({ receiptId: A, createdAt: 1_000, closedAt: 7_000, status: 'closed', reason: 'expired' });
      expect(JSON.stringify(await storage.getAll())).not.toContain(S);
      expect(await s.listPending()).toEqual([]);
      expect(await s.listClosed()).toEqual([closed]);
    });
  });
}

suite('memory storage', createMemoryClaimStorage);

let n = 0;
suite('IndexedDB storage (idb on fake-indexeddb)', () => createIdbClaimStorage(openWalletDb(`test-${n++}`)));

describe('IndexedDB persistence', () => {
  it('survives reopening the database (a reload)', async () => {
    const name = `persist-${n++}`;
    await createPendingClaimStore(createIdbClaimStorage(openWalletDb(name)), () => 42).add(A, S, true);
    const reopened = createPendingClaimStore(createIdbClaimStorage(openWalletDb(name)));
    expect(await reopened.listPending()).toEqual([{ receiptId: A, secret: S, createdAt: 42, lastAttemptAt: null, autoClaim: true, status: 'pending' }]);
  });
});
