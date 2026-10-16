/** Pending-claim retry policy (v2 §13): retry on app open, `online` and `visibilitychange`, for up to 7 days. */
import type { ClosedClaim, ClosedReason, PendingClaim, PendingClaimStore } from './pending-claims.ts';

export const PENDING_CLAIM_TTL_MS = 7 * 24 * 3_600_000;
/** several triggers can fire together (open + online + visibility); do not hammer the API */
export const MIN_RETRY_INTERVAL_MS = 10_000;

export type PendingDecision = 'expired' | 'due' | 'wait';

export function decidePending(
  claim: Pick<PendingClaim, 'createdAt' | 'lastAttemptAt'>,
  now: number,
  minIntervalMs = MIN_RETRY_INTERVAL_MS,
): PendingDecision {
  if (now - claim.createdAt >= PENDING_CLAIM_TTL_MS) return 'expired';
  if (claim.lastAttemptAt === null || claim.lastAttemptAt > now) return 'due';
  return now - claim.lastAttemptAt >= minIntervalMs ? 'due' : 'wait';
}

export type ClaimOutcome = 'claimed' | 'already_yours' | 'already_claimed' | 'claim_expired' | 'unauthorized' | 'retry';

/** Map a POST /v1/me/claims HTTP status (0 = network failure) to what the retrier does next. */
export function classifyClaimStatus(status: number): ClaimOutcome {
  if (status === 201) return 'claimed';
  if (status === 200) return 'already_yours';
  if (status === 409) return 'already_claimed';
  if (status === 410) return 'claim_expired';
  if (status === 401) return 'unauthorized';
  // 0 network, 404 (the shop has not uploaded it yet, or a wrong secret: indistinguishable), 429, 5xx
  return 'retry';
}

export interface RetryDeps {
  store: PendingClaimStore;
  attempt(claim: PendingClaim): Promise<ClaimOutcome>;
  now(): number;
  /** 0 on the `online` event: connectivity just changed, so a failed attempt seconds ago says nothing. */
  minIntervalMs?: number;
}

export interface RetrySummary {
  /** receipts now in the wallet */
  saved: string[];
  /** closed this run: gave up after 7 days, or the server refused for good */
  closed: ClosedClaim[];
  attempted: number;
  /** a 401 stopped the run: the session is gone */
  unauthorized: boolean;
}

const CLOSE_REASON: Partial<Record<ClaimOutcome, ClosedReason>> = { already_claimed: 'already_claimed', claim_expired: 'claim_expired' };

export async function retryPendingClaims(deps: RetryDeps): Promise<RetrySummary> {
  const summary: RetrySummary = { saved: [], closed: [], attempted: 0, unauthorized: false };
  for (const claim of await deps.store.listPending()) {
    const now = deps.now();
    const decision = decidePending(claim, now, deps.minIntervalMs);
    if (decision === 'expired') {
      summary.closed.push(await deps.store.close(claim.receiptId, 'expired', now));
      continue;
    }
    if (decision === 'wait' || !claim.autoClaim) continue;
    await deps.store.markAttempt(claim.receiptId, now);
    summary.attempted += 1;
    const outcome = await deps.attempt(claim);
    if (outcome === 'unauthorized') {
      summary.unauthorized = true;
      break;
    }
    if (outcome === 'claimed' || outcome === 'already_yours') {
      await deps.store.remove(claim.receiptId);
      summary.saved.push(claim.receiptId);
      continue;
    }
    const reason = CLOSE_REASON[outcome];
    if (reason) summary.closed.push(await deps.store.close(claim.receiptId, reason, deps.now()));
  }
  return summary;
}

/** Coalesce concurrent triggers into one run. */
export function singleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    inFlight ??= run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/** Delay before re-asking the resolver while the shop's upload has not arrived: 3 s, 6 s, 12 s … capped at 30 s. */
export function pendingPollDelayMs(attempt: number): number {
  return Math.min(30_000, 3_000 * 2 ** attempt);
}
