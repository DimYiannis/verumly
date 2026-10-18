import { describe, expect, it } from 'vitest';
import { presetRange } from '../app/lib/report.ts';

// 2026-10-17 23:37 UTC is already 2026-10-18 01:37 in Amsterdam (CEST, UTC+2): the case that broke the CI run
const LATE_EVENING_UTC = new Date('2026-10-17T23:37:00Z');

describe('report presets use the Amsterdam day', () => {
  it('between 22:00 and 24:00 UTC "today" is already the next Amsterdam day', () => {
    expect(presetRange('today', LATE_EVENING_UTC)).toEqual({ from: '2026-10-18', to: '2026-10-18' });
    expect(presetRange('last30', LATE_EVENING_UTC)).toEqual({ from: '2026-09-19', to: '2026-10-18' });
    expect(presetRange('last7', LATE_EVENING_UTC)).toEqual({ from: '2026-10-12', to: '2026-10-18' });
  });

  it('an ordinary afternoon gives the same day in both', () => {
    expect(presetRange('today', new Date('2026-10-17T12:00:00Z'))).toEqual({ from: '2026-10-17', to: '2026-10-17' });
  });

  it('months, quarters and the year', () => {
    const now = new Date('2026-11-15T10:00:00Z');
    expect(presetRange('thisMonth', now)).toEqual({ from: '2026-11-01', to: '2026-11-15' });
    expect(presetRange('lastMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('quarter', now)).toEqual({ from: '2026-10-01', to: '2026-11-15' });
    expect(presetRange('ytd', now)).toEqual({ from: '2026-01-01', to: '2026-11-15' });
  });

  it('last month in January is December of the year before; the last day of a month is the next month in Amsterdam late in the evening', () => {
    expect(presetRange('lastMonth', new Date('2027-01-20T10:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    // 2026-10-31 23:30 UTC is 2026-11-01 00:30 in Amsterdam (CET starts on 25 October)
    expect(presetRange('thisMonth', new Date('2026-10-31T23:30:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-01' });
  });
});
