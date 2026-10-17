import { describe, expect, it } from 'vitest';
import { formatRelative } from '../app/utils/relative-time.ts';

const now = new Date('2026-10-17T12:00:00Z');

describe('formatRelative', () => {
  it('uses minutes, hours and days', () => {
    expect(formatRelative('2026-10-17T11:30:00Z', 'en', now)).toBe('30 minutes ago');
    expect(formatRelative('2026-10-17T10:00:00Z', 'en', now)).toBe('2 hours ago');
    expect(formatRelative('2026-10-14T12:00:00Z', 'en', now)).toBe('3 days ago');
  });
  it('says yesterday and now', () => {
    expect(formatRelative('2026-10-16T12:00:00Z', 'en', now)).toBe('yesterday');
    expect(formatRelative('2026-10-17T11:59:50Z', 'en', now)).toBe('this minute');
  });
  it('is Dutch on request', () => {
    expect(formatRelative('2026-10-17T10:00:00Z', 'nl', now)).toBe('2 uur geleden');
  });
  it('falls back to a date after a month', () => {
    expect(formatRelative('2026-08-01T12:00:00Z', 'en', now)).toMatch(/2026/);
  });
});
