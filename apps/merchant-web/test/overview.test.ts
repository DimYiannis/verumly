import { describe, expect, it } from 'vitest';
import { addDays, amsterdamNow, countWeekday, cumulative, hourlyGross, isLate, isOnline } from '../app/lib/overview.ts';

describe('overview helpers', () => {
  it('computes Amsterdam today, hour and weekday regardless of the host zone', () => {
    // 22:30 UTC on Saturday 17 Oct 2026 is already 00:30 Sunday in Amsterdam (CEST, UTC+2)
    expect(amsterdamNow(new Date('2026-10-17T22:30:00Z'))).toEqual({ ymd: '2026-10-18', hour: 0, isoWeekday: 7 });
    expect(amsterdamNow(new Date('2026-10-17T10:00:00Z'))).toEqual({ ymd: '2026-10-17', hour: 12, isoWeekday: 6 });
  });

  it('does calendar arithmetic and counts weekdays in a 28-day window', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(countWeekday(addDays('2026-10-17', -28), addDays('2026-10-17', -1), 6)).toBe(4);
  });

  it('builds per-hour and cumulative series, and the usual-day average', () => {
    const rows = [{ key: '9', values: { gross: 400 } }, { key: '11', values: { gross: 800 } }];
    expect(hourlyGross(rows)[9]).toBe(400);
    expect(cumulative(hourlyGross(rows)).slice(8, 13)).toEqual([0, 400, 400, 1200, 1200]);
    expect(cumulative(hourlyGross(rows, 4)).slice(9, 12)).toEqual([100, 100, 300]);
  });

  it('flags terminals online within 5 minutes and receipts late after 10', () => {
    const now = Date.parse('2026-10-17T12:00:00Z');
    expect(isOnline('2026-10-17T11:57:00Z', now)).toBe(true);
    expect(isOnline('2026-10-17T11:50:00Z', now)).toBe(false);
    expect(isOnline(null, now)).toBe(false);
    expect(isLate({ createdAt: '2026-10-17T11:00:00Z', receivedAt: '2026-10-17T11:11:00Z' })).toBe(true);
    expect(isLate({ createdAt: '2026-10-17T11:00:00Z', receivedAt: '2026-10-17T11:05:00Z' })).toBe(false);
  });
});
