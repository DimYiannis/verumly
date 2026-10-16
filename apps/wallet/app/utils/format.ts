/** Locale-aware (Dutch by default) formatting and list helpers. Receipt times are shown in Europe/Amsterdam (v2 §2.6). */
import { messages, type Locale } from '../i18n/index.ts';
import type { ReceiptFilters, ReceiptListItem } from './api-schemas.ts';

const TZ = 'Europe/Amsterdam';
const BCP47: Record<Locale, string> = { nl: 'nl-NL', en: 'en-GB' };
const euros: Partial<Record<Locale, Intl.NumberFormat>> = {};

export function formatEuro(cents: number, locale: Locale = 'en'): string {
  const fmt = (euros[locale] ??= new Intl.NumberFormat(BCP47[locale], { style: 'currency', currency: 'EUR' }));
  return fmt.format(cents / 100);
}

export function formatQty(qty: string, locale: Locale = 'en'): string {
  return locale === 'nl' ? qty.replace('.', ',') : qty;
}

export function formatTime(iso: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(BCP47[locale], { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(BCP47[locale], { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** `YYYY-MM-DD` of the Amsterdam calendar day the instant falls on */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso));
}

export function formatDayHeading(key: string, today: Date = new Date(), locale: Locale = 'en'): string {
  const todayKey = dayKey(today.toISOString());
  const yesterdayKey = dayKey(new Date(today.getTime() - 86_400_000).toISOString());
  if (key === todayKey) return messages[locale]['day.today'];
  if (key === yesterdayKey) return messages[locale]['day.yesterday'];
  return new Intl.DateTimeFormat(BCP47[locale], { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00Z`));
}

export interface DayGroup<T> {
  day: string;
  items: T[];
}

/** Group items (already newest first) by Amsterdam calendar day, preserving order. */
export function groupByDay<T extends { createdAt: string }>(items: T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = dayKey(item.createdAt);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/** Offline equivalent of the server filters, applied to the cached list. Category needs line data, so it is not filtered offline. */
export function filterCachedItems(items: ReceiptListItem[], f: ReceiptFilters): ReceiptListItem[] {
  const q = f.q?.trim().toLowerCase();
  const merchant = f.merchant?.trim().toLowerCase();
  return items.filter((i) => {
    if (f.state && i.state !== f.state) return false;
    const day = dayKey(i.createdAt);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (merchant && !i.merchantName.toLowerCase().includes(merchant)) return false;
    if (q && !`${i.merchantName} ${i.locationName}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function centsFromInput(value: string): number | null {
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] ? -cents : cents;
}

export function inputFromCents(cents: number | null): string {
  if (cents === null) return '';
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function amsterdamOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) - Math.floor(utcMs / 60_000) * 60_000;
}

/** `YYYY-MM-DDTHH:mm` wall-clock in Amsterdam, for `<input type="datetime-local">` */
export function utcIsoToAmsterdamLocal(iso: string): string {
  const ms = new Date(iso).getTime();
  return new Date(ms + amsterdamOffsetMs(ms)).toISOString().slice(0, 16);
}

/** Inverse of `utcIsoToAmsterdamLocal`: what the buyer typed (Amsterdam time) as a UTC ISO string. */
export function amsterdamLocalToUtcIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const guess = wall - amsterdamOffsetMs(wall);
  const utc = wall - amsterdamOffsetMs(guess);
  return new Date(utc).toISOString();
}
