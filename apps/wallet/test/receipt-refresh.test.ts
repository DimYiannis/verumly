import { describe, expect, it } from 'vitest';
import { RECEIPT_REFRESH_MS, isNewerVersion, shouldPollReceipt } from '../app/utils/receipt-refresh.ts';

describe('shouldPollReceipt', () => {
  it('polls only while the page is visible and online', () => {
    expect(shouldPollReceipt({ visible: true, online: true })).toBe(true);
    expect(shouldPollReceipt({ visible: false, online: true })).toBe(false);
    expect(shouldPollReceipt({ visible: true, online: false })).toBe(false);
    expect(shouldPollReceipt({ visible: false, online: false })).toBe(false);
  });
  it('asks within a few seconds, but not in a tight loop', () => {
    expect(RECEIPT_REFRESH_MS).toBeGreaterThanOrEqual(3_000);
    expect(RECEIPT_REFRESH_MS).toBeLessThanOrEqual(10_000);
  });
});

describe('isNewerVersion', () => {
  const v = (version: number) => ({ receipt: { version } });
  it('accepts the first load and strictly newer versions', () => {
    expect(isNewerVersion(null, v(1))).toBe(true);
    expect(isNewerVersion(v(1), v(2))).toBe(true);
  });
  it('ignores the same or an older version', () => {
    expect(isNewerVersion(v(2), v(2))).toBe(false);
    expect(isNewerVersion(v(2), v(1))).toBe(false);
  });
});
