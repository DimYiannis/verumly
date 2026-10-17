import type { Locale } from '../i18n/index.ts';

const BCP47: Record<Locale, string> = { nl: 'nl-NL', en: 'en-GB' };

/** "2 hours ago", "yesterday", "3 days ago"; older than a month falls back to a short date. */
export function formatRelative(iso: string, locale: Locale = 'en', now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(BCP47[locale], { numeric: 'auto' });
  const MIN = 60_000;
  if (abs < MIN) return rtf.format(0, 'minute');
  if (abs < 60 * MIN) return rtf.format(Math.round(diff / MIN), 'minute');
  if (abs < 24 * 60 * MIN) return rtf.format(Math.round(diff / (60 * MIN)), 'hour');
  if (abs < 30 * 24 * 60 * MIN) return rtf.format(Math.round(diff / (24 * 60 * MIN)), 'day');
  return new Intl.DateTimeFormat(BCP47[locale], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
