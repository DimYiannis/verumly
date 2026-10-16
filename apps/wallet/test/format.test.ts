import { describe, expect, it } from 'vitest';
import type { ReceiptListItem } from '../app/utils/api-schemas.ts';
import {
  amsterdamLocalToUtcIso,
  centsFromInput,
  dayKey,
  filterCachedItems,
  formatDayHeading,
  formatEuro,
  groupByDay,
  inputFromCents,
  utcIsoToAmsterdamLocal,
} from '../app/utils/format.ts';

function item(id: string, createdAt: string, merchantName = 'Café Het Plein', state = 'paid'): ReceiptListItem {
  return { receiptId: id, merchantName, locationName: 'Kassa', total: 100, currency: 'EUR', createdAt, claimedAt: createdAt, source: 'qr', state, version: 1, final: state === 'paid' };
}

describe('formatEuro', () => {
  it('uses English (en-NL) formatting', () => {
    expect(formatEuro(123456).replace(/\s/g, ' ')).toBe('€1,234.56');
    expect(formatEuro(-250).replace(/\s/g, ' ')).toBe('-€2.50');
    expect(formatEuro(680).replace(/\s/g, ' ')).toBe('€6.80');
  });
});

describe('Amsterdam days', () => {
  it('assigns an instant to the Amsterdam calendar day, not the UTC day', () => {
    expect(dayKey('2026-01-10T23:30:00Z')).toBe('2026-01-11'); // CET = UTC+1
    expect(dayKey('2026-07-10T22:30:00Z')).toBe('2026-07-11'); // CEST = UTC+2
    expect(dayKey('2026-07-10T21:30:00Z')).toBe('2026-07-10');
  });

  it('groups newest-first items by day, preserving order', () => {
    const groups = groupByDay([item('a', '2026-07-11T10:00:00Z'), item('b', '2026-07-10T22:30:00Z'), item('c', '2026-07-10T08:00:00Z'), item('d', '2026-07-09T08:00:00Z')]);
    expect(groups.map((g) => [g.day, g.items.map((i) => i.receiptId)])).toEqual([
      ['2026-07-11', ['a', 'b']],
      ['2026-07-10', ['c']],
      ['2026-07-09', ['d']],
    ]);
  });

  it('labels today, yesterday and older days in English', () => {
    const now = new Date('2026-10-16T12:00:00Z');
    expect(formatDayHeading('2026-10-16', now)).toBe('Today');
    expect(formatDayHeading('2026-10-15', now)).toBe('Yesterday');
    expect(formatDayHeading('2026-10-10', now)).toBe('Saturday 10 October');
  });
});

describe('Amsterdam local time <-> UTC', () => {
  it('converts winter and summer time', () => {
    expect(amsterdamLocalToUtcIso('2026-01-10T18:30')).toBe('2026-01-10T17:30:00.000Z');
    expect(amsterdamLocalToUtcIso('2026-07-10T18:30')).toBe('2026-07-10T16:30:00.000Z');
    expect(utcIsoToAmsterdamLocal('2026-07-10T16:30:00Z')).toBe('2026-07-10T18:30');
    expect(utcIsoToAmsterdamLocal('2026-01-10T17:30:00Z')).toBe('2026-01-10T18:30');
  });
  it('round-trips and rejects malformed input', () => {
    const iso = '2026-10-16T09:45:00.000Z';
    expect(amsterdamLocalToUtcIso(utcIsoToAmsterdamLocal(iso))).toBe(iso);
    expect(amsterdamLocalToUtcIso('16-10-2026 11:45')).toBeNull();
  });
});

describe('euro input', () => {
  it('parses comma and dotted decimals into cents', () => {
    expect(centsFromInput('12,50')).toBe(1250);
    expect(centsFromInput('12.5')).toBe(1250);
    expect(centsFromInput('7')).toBe(700);
    expect(centsFromInput('-0,05')).toBe(-5);
    expect(centsFromInput('1.234,56')).toBeNull();
    expect(centsFromInput('abc')).toBeNull();
    expect(centsFromInput('')).toBeNull();
  });
  it('formats cents for an input', () => {
    expect(inputFromCents(1250)).toBe('12.50');
    expect(inputFromCents(-5)).toBe('-0.05');
    expect(inputFromCents(null)).toBe('');
  });
});

describe('filterCachedItems (offline search)', () => {
  const items = [
    item('a', '2026-10-10T10:00:00Z', 'Albert Heijn', 'paid'),
    item('b', '2026-10-12T10:00:00Z', 'Café Het Plein', 'presented'),
    item('c', '2026-10-14T10:00:00Z', 'Café Het Plein', 'void'),
  ];
  it('filters by text, merchant, state and date range', () => {
    expect(filterCachedItems(items, { q: 'albert' }).map((i) => i.receiptId)).toEqual(['a']);
    expect(filterCachedItems(items, { merchant: 'plein' }).map((i) => i.receiptId)).toEqual(['b', 'c']);
    expect(filterCachedItems(items, { state: 'presented' }).map((i) => i.receiptId)).toEqual(['b']);
    expect(filterCachedItems(items, { from: '2026-10-11', to: '2026-10-13' }).map((i) => i.receiptId)).toEqual(['b']);
    expect(filterCachedItems(items, {})).toHaveLength(3);
  });
});
