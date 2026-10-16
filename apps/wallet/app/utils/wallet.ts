import { shallowRef, ref } from 'vue';
import { ApiError, createApi } from './api.ts';
import { createIdbClaimStorage, createKv, createReceiptCache, openWalletDb, type Session } from './idb.ts';
import { createPendingClaimStore, type ClosedClaim, type PendingClaim } from './pending-claims.ts';
import { classifyClaimStatus, retryPendingClaims, singleFlight } from './retry.ts';
import { createSessionStore } from './session.ts';

export interface WalletOptions {
  buyerApi: string;
  /** receipt secrets captured from the URL fragment (memory only) */
  vault: Record<string, string>;
}

/** Everything stateful in the wallet: session, API client, offline stores, pending-claim retrier. Browser only. */
export async function createWallet(opts: WalletOptions) {
  const db = openWalletDb();
  const kv = createKv(db);
  const sessionStore = createSessionStore(kv);
  const cache = createReceiptCache(db);
  const claims = createPendingClaimStore(createIdbClaimStorage(db));

  const session = shallowRef<Session | null>(await sessionStore.load());
  const pending = shallowRef<PendingClaim[]>([]);
  const closed = shallowRef<ClosedClaim[]>([]);
  const online = ref(navigator.onLine);
  /** bumped whenever a background claim lands, so open lists reload */
  const savedTick = ref(0);

  const api = createApi({ baseUrl: opts.buyerApi, getToken: () => session.value?.token ?? null });

  async function refreshPending() {
    pending.value = await claims.listPending();
    closed.value = await claims.listClosed();
  }

  async function cacheReceipt(receiptId: string) {
    try {
      await cache.putDetail(await api.getReceipt(receiptId));
    } catch {
      // offline caching is best effort; the receipt itself is already saved server-side
    }
  }

  async function endSession() {
    session.value = null;
    await sessionStore.clear();
  }

  let forceNext = false;
  const retry = singleFlight(async () => {
    if (!session.value) return;
    const force = forceNext;
    forceNext = false;
    const summary = await retryPendingClaims({
      store: claims,
      now: Date.now,
      minIntervalMs: force ? 0 : undefined,
      async attempt(claim) {
        try {
          return classifyClaimStatus(await api.claim(claim.receiptId, claim.secret));
        } catch (e) {
          return e instanceof ApiError ? classifyClaimStatus(e.status) : 'retry';
        }
      },
    });
    for (const id of summary.saved) await cacheReceipt(id);
    if (summary.unauthorized) await endSession();
    await refreshPending();
    if (summary.saved.length > 0) savedTick.value += 1;
  });

  // Retry on app open, `online` and `visibilitychange` (v2 §13). No Background Sync API.
  window.addEventListener('online', () => {
    online.value = true;
    forceNext = true;
    // if a run was already in flight it may have missed the flag: run once more
    void retry().then(() => (forceNext ? retry() : undefined));
  });
  window.addEventListener('offline', () => {
    online.value = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void retry();
  });

  return {
    api,
    kv,
    cache,
    claims,
    session,
    pending,
    closed,
    online,
    savedTick,
    refreshPending,
    endSession,
    retryPending: retry,
    cacheReceipt,
    vault: opts.vault,
    async login(email: string, code: string): Promise<void> {
      const res = await api.emailVerify(email, code);
      const next = { token: res.token, userId: res.userId, email };
      await sessionStore.save(next);
      session.value = next;
    },
    /** Explicit logout: also wipes cached receipts and pending claims so the next person on this phone sees nothing. */
    async logout(): Promise<void> {
      try {
        await api.logout();
      } catch {
        // token may already be invalid or we are offline; local state is cleared either way
      }
      await endSession();
      await cache.clear();
      for (const c of [...(await claims.listPending()), ...(await claims.listClosed())]) await claims.remove(c.receiptId);
      await refreshPending();
    },
  };
}
