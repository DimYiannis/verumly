/** Pending-claim store (v2 §13): `{receiptId, secret, createdAt}` records that survive reloads and offline spells. */

export type ClosedReason = 'expired' | 'already_claimed' | 'claim_expired';

export interface PendingClaim {
  receiptId: string;
  secret: string;
  /** epoch ms */
  createdAt: number;
  lastAttemptAt: number | null;
  /**
   * true: claim in the background as soon as possible (the buyer already chose Save, or was offline when scanning).
   * false: parked until the buyer confirms on the "Save this receipt?" sheet (a logged-out "Save to wallet" tap).
   */
  autoClaim: boolean;
  status: 'pending';
}

/** A claim we gave up on. The secret is dropped; the record stays so the wallet can say why until dismissed. */
export interface ClosedClaim {
  receiptId: string;
  createdAt: number;
  closedAt: number;
  status: 'closed';
  reason: ClosedReason;
}

export type StoredClaim = PendingClaim | ClosedClaim;

/** Persistence seam: IndexedDB in the browser (idb.ts), an in-memory map in tests. */
export interface ClaimStorage {
  get(receiptId: string): Promise<StoredClaim | undefined>;
  getAll(): Promise<StoredClaim[]>;
  put(claim: StoredClaim): Promise<void>;
  delete(receiptId: string): Promise<void>;
}

export interface PendingClaimStore {
  /**
   * Idempotent: adding an id that is already pending keeps the original `createdAt` (the 7 days run from the first sighting).
   * `autoClaim: true` upgrades a parked claim; it never downgrades one.
   */
  add(receiptId: string, secret: string, autoClaim: boolean): Promise<PendingClaim>;
  get(receiptId: string): Promise<StoredClaim | undefined>;
  listPending(): Promise<PendingClaim[]>;
  listClosed(): Promise<ClosedClaim[]>;
  markAttempt(receiptId: string, at: number): Promise<void>;
  close(receiptId: string, reason: ClosedReason, at: number): Promise<ClosedClaim>;
  remove(receiptId: string): Promise<void>;
}

export function createPendingClaimStore(storage: ClaimStorage, now: () => number = Date.now): PendingClaimStore {
  const byAge = (a: StoredClaim, b: StoredClaim) => a.createdAt - b.createdAt;
  return {
    async add(receiptId, secret, autoClaim) {
      const existing = await storage.get(receiptId);
      if (existing?.status === 'pending') {
        if (!autoClaim || existing.autoClaim) return existing;
        const upgraded: PendingClaim = { ...existing, autoClaim: true };
        await storage.put(upgraded);
        return upgraded;
      }
      const claim: PendingClaim = { receiptId, secret, createdAt: now(), lastAttemptAt: null, autoClaim, status: 'pending' };
      await storage.put(claim);
      return claim;
    },
    get: (receiptId) => storage.get(receiptId),
    async listPending() {
      return (await storage.getAll()).filter((c) => c.status === 'pending').sort(byAge);
    },
    async listClosed() {
      return (await storage.getAll()).filter((c) => c.status === 'closed').sort(byAge);
    },
    async markAttempt(receiptId, at) {
      const claim = await storage.get(receiptId);
      if (claim?.status === 'pending') await storage.put({ ...claim, lastAttemptAt: at });
    },
    async close(receiptId, reason, at) {
      const prev = await storage.get(receiptId);
      const closed: ClosedClaim = { receiptId, createdAt: prev?.createdAt ?? at, closedAt: at, status: 'closed', reason };
      await storage.put(closed);
      return closed;
    },
    remove: (receiptId) => storage.delete(receiptId),
  };
}

export function createMemoryClaimStorage(): ClaimStorage {
  const rows: Record<string, StoredClaim> = {};
  return {
    get: async (id) => rows[id],
    getAll: async () => Object.values(rows),
    async put(claim) {
      rows[claim.receiptId] = claim;
    },
    async delete(id) {
      delete rows[id];
    },
  };
}
