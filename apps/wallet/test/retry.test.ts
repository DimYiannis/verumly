import { describe, expect, it } from 'vitest';
import { createMemoryClaimStorage, createPendingClaimStore } from '../app/utils/pending-claims.ts';
import {
  MIN_RETRY_INTERVAL_MS,
  PENDING_CLAIM_TTL_MS,
  classifyClaimStatus,
  decidePending,
  pendingPollDelayMs,
  retryPendingClaims,
  singleFlight,
  type ClaimOutcome,
} from '../app/utils/retry.ts';

const A = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c40';
const B = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c41';
const C = '0199f3a2-7c1e-7a55-9c3e-5d8f2b6a1c42';
const S = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRkdISUo';
const DAY = 86_400_000;

describe('decidePending', () => {
  const claim = { createdAt: 0, lastAttemptAt: null };

  it('is due when never attempted', () => {
    expect(decidePending(claim, 1)).toBe('due');
  });
  it('waits within the minimum interval, is due after it', () => {
    const c = { createdAt: 0, lastAttemptAt: 100_000 };
    expect(decidePending(c, 100_000 + MIN_RETRY_INTERVAL_MS - 1)).toBe('wait');
    expect(decidePending(c, 100_000 + MIN_RETRY_INTERVAL_MS)).toBe('due');
  });
  it('treats an attempt in the future (clock change) as due', () => {
    expect(decidePending({ createdAt: 0, lastAttemptAt: 5_000_000 }, 1_000_000)).toBe('due');
  });
  it('expires after exactly 7 days, not before', () => {
    expect(PENDING_CLAIM_TTL_MS).toBe(7 * DAY);
    expect(decidePending(claim, 7 * DAY - 1)).toBe('due');
    expect(decidePending(claim, 7 * DAY)).toBe('expired');
    expect(decidePending({ createdAt: 0, lastAttemptAt: 7 * DAY - 5 }, 8 * DAY)).toBe('expired');
  });
});

describe('classifyClaimStatus', () => {
  it.each<[number, ClaimOutcome]>([
    [201, 'claimed'],
    [200, 'already_yours'],
    [409, 'already_claimed'],
    [410, 'claim_expired'],
    [401, 'unauthorized'],
    [0, 'retry'],
    [404, 'retry'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
  ])('HTTP %i → %s', (status, outcome) => {
    expect(classifyClaimStatus(status)).toBe(outcome);
  });
});

describe('pendingPollDelayMs', () => {
  it('backs off 3s, 6s, 12s … capped at 30s', () => {
    expect([0, 1, 2, 3, 4, 10].map(pendingPollDelayMs)).toEqual([3_000, 6_000, 12_000, 24_000, 30_000, 30_000]);
  });
});

function setup(outcomes: Record<string, ClaimOutcome>) {
  let now = 1_000_000;
  const store = createPendingClaimStore(createMemoryClaimStorage(), () => now);
  const attempts: string[] = [];
  const run = () =>
    retryPendingClaims({
      store,
      now: () => now,
      async attempt(claim) {
        attempts.push(claim.receiptId);
        return outcomes[claim.receiptId] ?? 'retry';
      },
    });
  return { store, attempts, run, advance: (ms: number) => (now += ms) };
}

describe('retryPendingClaims', () => {
  it('claims what is due, removes saved ones, keeps retryable ones', async () => {
    const t = setup({ [A]: 'claimed', [B]: 'retry', [C]: 'already_yours' });
    for (const id of [A, B, C]) await t.store.add(id, S, true);
    const summary = await t.run();
    expect(t.attempts).toEqual([A, B, C]);
    expect(summary).toMatchObject({ saved: [A, C], closed: [], attempted: 3, unauthorized: false });
    expect((await t.store.listPending()).map((c) => c.receiptId)).toEqual([B]);
  });

  it('does not retry again within the minimum interval (open + online + visibility fire together)', async () => {
    const t = setup({});
    await t.store.add(A, S, true);
    await t.run();
    await t.run();
    expect(t.attempts).toEqual([A]);
    t.advance(MIN_RETRY_INTERVAL_MS);
    await t.run();
    expect(t.attempts).toEqual([A, A]);
  });

  it('with minIntervalMs 0 (the online event) retries immediately after a failed attempt', async () => {
    const t = setup({});
    await t.store.add(A, S, true);
    await t.run();
    await retryPendingClaims({
      store: t.store,
      now: () => 1_000_000,
      minIntervalMs: 0,
      async attempt(c) {
        t.attempts.push(c.receiptId);
        return 'retry';
      },
    });
    expect(t.attempts).toEqual([A, A]);
  });

  it('after 7 days closes the claim as expired, drops the secret and does not call the API', async () => {
    const t = setup({});
    await t.store.add(A, S, true);
    t.advance(7 * DAY);
    const summary = await t.run();
    expect(t.attempts).toEqual([]);
    expect(summary.closed).toMatchObject([{ receiptId: A, reason: 'expired', status: 'closed' }]);
    expect(await t.store.listPending()).toEqual([]);
    expect((await t.store.listClosed())[0]).not.toHaveProperty('secret');
  });

  it('keeps retrying right up to the 7-day limit', async () => {
    const t = setup({ [A]: 'claimed' });
    await t.store.add(A, S, true);
    t.advance(7 * DAY - 1);
    expect((await t.run()).saved).toEqual([A]);
  });

  it('closes permanently refused claims with the reason', async () => {
    const t = setup({ [A]: 'already_claimed', [B]: 'claim_expired' });
    await t.store.add(A, S, true);
    await t.store.add(B, S, true);
    const summary = await t.run();
    expect(summary.closed.map((c) => [c.receiptId, c.reason])).toEqual([
      [A, 'already_claimed'],
      [B, 'claim_expired'],
    ]);
  });

  it('stops on 401 and leaves every claim pending', async () => {
    const t = setup({ [A]: 'unauthorized' });
    await t.store.add(A, S, true);
    await t.store.add(B, S, true);
    const summary = await t.run();
    expect(summary.unauthorized).toBe(true);
    expect(t.attempts).toEqual([A]);
    expect(await t.store.listPending()).toHaveLength(2);
  });

  it('never claims a parked claim (waiting for the buyer to confirm on the sheet) but still expires it', async () => {
    const t = setup({ [A]: 'claimed' });
    await t.store.add(A, S, false);
    expect((await t.run()).attempted).toBe(0);
    expect(t.attempts).toEqual([]);
    t.advance(7 * DAY);
    expect((await t.run()).closed[0]?.reason).toBe('expired');
  });
});

describe('singleFlight', () => {
  it('runs concurrent triggers once', async () => {
    let runs = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const f = singleFlight(async () => {
      runs += 1;
      await gate;
      return runs;
    });
    const p = [f(), f(), f()];
    release();
    expect(await Promise.all(p)).toEqual([1, 1, 1]);
    expect(await f()).toBe(2);
  });
});
