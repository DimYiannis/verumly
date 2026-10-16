import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffMs, MemoryStore } from '../src/index.ts';
import { fakeServer, sdkFor, simpleDraft } from './support.ts';

describe('backoffMs: exponential with jitter', () => {
  it('doubles from the base until the cap (no jitter point: random = 1 gives the full delay)', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((a) => backoffMs(a, 1))).toEqual([500, 1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });

  it('jitter scales the delay into [50%, 100%] of the exponential value', () => {
    for (const attempt of [0, 1, 2, 3, 5, 10, 40]) {
      const full = Math.min(30_000, 500 * 2 ** attempt);
      expect(backoffMs(attempt, 0)).toBe(Math.round(full * 0.5));
      expect(backoffMs(attempt, 0.999999)).toBeLessThanOrEqual(full);
      for (let i = 0; i <= 100; i++) {
        const d = backoffMs(attempt, i / 101);
        expect(d).toBeGreaterThanOrEqual(Math.round(full * 0.5));
        expect(d).toBeLessThanOrEqual(full);
      }
    }
  });

  it('is monotonic in the random draw and never exceeds the cap, even for huge attempt numbers', () => {
    let last = 0;
    for (let i = 0; i < 1000; i++) {
      const d = backoffMs(3, i / 1000);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    for (const attempt of [50, 1000, 10_000]) expect(backoffMs(attempt, 0.9999)).toBeLessThanOrEqual(30_000);
  });

  it('honours a custom base and cap', () => {
    expect(backoffMs(0, 1, 100, 1000)).toBe(100);
    expect(backoffMs(3, 1, 100, 1000)).toBe(800);
    expect(backoffMs(4, 1, 100, 1000)).toBe(1000);
    expect(backoffMs(4, 0, 100, 1000)).toBe(500);
  });

  it('actually spreads: different random draws give different delays (no thundering herd)', () => {
    const delays = new Set(Array.from({ length: 50 }, (_, i) => backoffMs(4, i / 50)));
    expect(delays.size).toBeGreaterThan(40);
  });
});

describe('startFlusher retries with backoff, then resets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('while the API is down the retry gaps grow 250, 500, 1000 ms (random = 0); once it recovers the queue drains and the attempt counter resets', async () => {
    let up = false;
    const server = fakeServer({ request: () => (up ? undefined : 'network') });
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch, random: () => 0 });
    await sdk.createReceipt(simpleDraft);

    sdk.startFlusher({ idleMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.requests).toHaveLength(1); // t=0
    await vi.advanceTimersByTimeAsync(249);
    expect(server.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // t=250
    expect(server.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(server.requests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // t=750
    expect(server.requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(server.requests).toHaveLength(3);
    up = true;
    await vi.advanceTimersByTimeAsync(1); // t=1750: succeeds
    expect(server.requests).toHaveLength(4);
    expect(server.accepted).toHaveLength(1);

    // drained: next wake-up is the idle interval, not a backoff delay
    await sdk.addVersion(server.accepted[0]!.split(':')[0]!, { state: 'paid' });
    await vi.advanceTimersByTimeAsync(4999);
    expect(server.requests).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.requests).toHaveLength(5);
    expect(server.accepted).toHaveLength(2);
    sdk.stopFlusher();
  });

  it('stopFlusher stops all further attempts', async () => {
    const server = fakeServer({ request: () => 'network' });
    const sdk = sdkFor(new MemoryStore(), { fetch: server.fetch, random: () => 0 });
    await sdk.createReceipt(simpleDraft);
    sdk.startFlusher();
    await vi.advanceTimersByTimeAsync(0);
    sdk.stopFlusher();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(server.requests).toHaveLength(1);
  });
});
