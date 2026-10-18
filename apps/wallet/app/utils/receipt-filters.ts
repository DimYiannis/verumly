import type { ReceiptListItem, UploadStatus } from './api-schemas.ts';
import { dayKey } from './format.ts';

/** what the receipts list filters on; `onlySplit` is the client-side "Shared" chip */
export interface ListFilterState {
  q: string;
  state: string;
  from: string;
  to: string;
  category: string;
  merchant: string;
  onlySplit: boolean;
}

/** stored category key -> every name the user can see for it (e.g. boodschappen -> Groceries, Boodschappen) */
export type CategoryNames = Record<string, string[]>;

const norm = (s: string) => s.trim().toLowerCase();

export function hasActiveFilters(f: ListFilterState): boolean {
  return Boolean(f.q.trim() || f.state || f.from || f.to || f.category.trim() || f.merchant.trim() || f.onlySplit);
}

/** the stored category for what the user typed: a key or a translated name, case-insensitive; otherwise the lower-cased input */
export function resolveCategory(input: string, names: CategoryNames): string {
  const n = norm(input);
  if (!n) return '';
  for (const [key, labels] of Object.entries(names)) {
    if (key.toLowerCase() === n || labels.some((l) => norm(l) === n)) return key;
  }
  return n;
}

/** till receipts: filtered on the server (`category` must be the resolved stored key) and, for Shared, on the split hints */
export function visibleReceipts(items: ReceiptListItem[], onlySplit: boolean, splitIds: ReadonlySet<string>): ReceiptListItem[] {
  return onlySplit ? items.filter((i) => splitIds.has(i.receiptId)) : items;
}

/** photo receipts: same filters as the receipts, applied client-side. A photo is never shared or cancelled. */
export function visiblePhotos(uploads: UploadStatus[], f: ListFilterState, names: CategoryNames): UploadStatus[] {
  if (f.onlySplit || f.state === 'void') return [];
  const q = norm(f.q);
  const merchant = norm(f.merchant);
  const category = resolveCategory(f.category, names);
  return uploads.filter((u) => {
    const d = u.draft;
    const day = dayKey(d?.printedAt ?? u.createdAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (merchant && !(d?.merchantName ?? '').toLowerCase().includes(merchant)) return false;
    if (q) {
      const hay = [d?.merchantName ?? '', ...(d?.lines ?? []).map((l) => l.description)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (category && !(d?.lines ?? []).some((l) => (l.userCategory ?? l.category ?? '').toLowerCase() === category)) return false;
    return true;
  });
}

/** sum of the shown, non-cancelled receipts of one month (`YYYY-MM`) in one currency */
export function monthTotal(shown: ReceiptListItem[], month: string, currency: string): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const i of shown) {
    if (i.state === 'void' || i.currency !== currency || !dayKey(i.createdAt).startsWith(month)) continue;
    total += i.total;
    count++;
  }
  return { total, count };
}
