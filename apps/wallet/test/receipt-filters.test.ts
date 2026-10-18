import { describe, expect, it } from 'vitest';
import type { ReceiptListItem, UploadStatus } from '../app/utils/api-schemas.ts';
import { hasActiveFilters, monthTotal, resolveCategory, visiblePhotos, visibleReceipts, type ListFilterState } from '../app/utils/receipt-filters.ts';

const names = { boodschappen: ['Groceries', 'Boodschappen'], dining: ['Food & drink', 'Eten & drinken'] };
const none: ListFilterState = { q: '', state: '', from: '', to: '', category: '', merchant: '', onlySplit: false };

function receipt(id: string, createdAt: string, total: number, state = 'paid'): ReceiptListItem {
  return { receiptId: id, merchantName: 'Shop', locationName: 'Kassa', total, currency: 'EUR', createdAt, claimedAt: createdAt, source: 'qr', state, version: 1, final: true };
}

function photo(id: string, merchantName: string | null, category?: string, printedAt = '2026-08-10T10:00:00Z'): UploadStatus {
  return {
    uploadId: id,
    status: 'done',
    failures: [],
    draft: { merchantName, printedAt, gross: 500, lines: [{ description: 'Cappuccino', qty: '1', unitPrice: 500, total: 500, vatRate: 9, kind: 'item', category }] },
    matchedReceiptId: null,
    match: null,
    createdAt: printedAt,
  };
}

describe('resolveCategory', () => {
  it('maps translated names and keys, any case, to the stored key', () => {
    expect(resolveCategory('Groceries', names)).toBe('boodschappen');
    expect(resolveCategory(' BOODSCHAPPEN ', names)).toBe('boodschappen');
    expect(resolveCategory('eten & drinken', names)).toBe('dining');
    expect(resolveCategory('Custom', names)).toBe('custom');
    expect(resolveCategory('  ', names)).toBe('');
  });
});

describe('visiblePhotos', () => {
  const photos = [photo('a', 'Elektro Mulder', 'elektronica'), photo('b', 'Albert Heijn', 'boodschappen', '2026-09-02T10:00:00Z')];

  it('keeps everything without filters', () => {
    expect(visiblePhotos(photos, none, names)).toHaveLength(2);
  });
  it('applies search, merchant and dates', () => {
    expect(visiblePhotos(photos, { ...none, q: 'elektro' }, names).map((p) => p.uploadId)).toEqual(['a']);
    expect(visiblePhotos(photos, { ...none, q: 'cappu' }, names)).toHaveLength(2);
    expect(visiblePhotos(photos, { ...none, merchant: 'heijn' }, names).map((p) => p.uploadId)).toEqual(['b']);
    expect(visiblePhotos(photos, { ...none, from: '2026-09-01' }, names).map((p) => p.uploadId)).toEqual(['b']);
    expect(visiblePhotos(photos, { ...none, to: '2026-08-31' }, names).map((p) => p.uploadId)).toEqual(['a']);
  });
  it('matches the category by translated name', () => {
    expect(visiblePhotos(photos, { ...none, category: 'Groceries' }, names).map((p) => p.uploadId)).toEqual(['b']);
  });
  it('hides photos under Shared and Cancelled', () => {
    expect(visiblePhotos(photos, { ...none, onlySplit: true }, names)).toEqual([]);
    expect(visiblePhotos(photos, { ...none, state: 'void' }, names)).toEqual([]);
    expect(visiblePhotos(photos, { ...none, state: 'paid' }, names)).toHaveLength(2);
  });
});

describe('monthTotal / visibleReceipts', () => {
  const items = [receipt('1', '2026-10-05T10:00:00Z', 620), receipt('2', '2026-10-06T10:00:00Z', 1000), receipt('3', '2026-10-07T10:00:00Z', 300, 'void'), receipt('4', '2026-08-01T10:00:00Z', 900)];

  it('sums only the shown receipts of the month, without cancelled ones', () => {
    expect(monthTotal(items, '2026-10', 'EUR')).toEqual({ total: 1620, count: 2 });
    const shared = visibleReceipts(items, true, new Set(['1']));
    expect(monthTotal(shared, '2026-10', 'EUR')).toEqual({ total: 620, count: 1 });
    expect(monthTotal([items[3]!], '2026-10', 'EUR')).toEqual({ total: 0, count: 0 });
  });
});

describe('hasActiveFilters', () => {
  it('detects any filter or the Shared chip', () => {
    expect(hasActiveFilters(none)).toBe(false);
    expect(hasActiveFilters({ ...none, q: ' x ' })).toBe(true);
    expect(hasActiveFilters({ ...none, onlySplit: true })).toBe(true);
    expect(hasActiveFilters({ ...none, q: '  ' })).toBe(false);
  });
});
