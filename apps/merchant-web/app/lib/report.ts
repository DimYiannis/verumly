import type { ReportMetric, ReportSpec } from '@lr/schema';
import { addDays, amsterdamNow } from './overview.ts';

/** Pure helpers of the report builder page (dates, labels, CSV). */

export const PRESETS = ['today', 'last7', 'last30', 'thisMonth', 'lastMonth', 'quarter', 'ytd'] as const;
export type Preset = (typeof PRESETS)[number] | 'custom';

export const MONEY_METRICS: readonly ReportMetric[] = ['gross', 'net', 'vat', 'tip', 'rounding', 'cancelledGross', 'avgTicket'];
export const isMoney = (m: ReportMetric): boolean => MONEY_METRICS.includes(m);
/** Metrics where going up is bad news (tints are inverted). */
export const NEGATIVE_METRICS: readonly ReportMetric[] = ['cancelled', 'cancelledGross'];
export const TIME_GROUPS = ['day', 'week', 'month', 'weekday', 'hour'];
export const RUBRIEK: Record<string, string> = { 21: '1a', 9: '1b', 0: '1e' };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The period of a preset, as YYYY-MM-DD days. "Today" is the Amsterdam calendar day, not the browser's: the reports bucket
 * receipts by Amsterdam day, so a browser in another time zone (or a CI runner in UTC between 22:00 and 24:00) would
 * otherwise ask for the wrong days and show zeros.
 */
export function presetRange(p: (typeof PRESETS)[number], now = new Date()): { from: string; to: string } {
  const today = amsterdamNow(now).ymd;
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monthStart = (year: number, month: number) => `${year}-${pad(month)}-01`;
  switch (p) {
    case 'today':
      return { from: today, to: today };
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: monthStart(y, m), to: today };
    case 'lastMonth': {
      const first = m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1);
      return { from: first, to: addDays(monthStart(y, m), -1) };
    }
    case 'quarter':
      return { from: monthStart(y, Math.floor((m - 1) / 3) * 3 + 1), to: today };
    case 'ytd':
      return { from: monthStart(y, 1), to: today };
  }
}

/** Decimal euros with a dot, for CSV. */
export const csvAmount = (cents: number): string => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

const csvCell = (v: string): string => (/[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function defaultSpec(): ReportSpec {
  return { ...presetRange('last30'), groupBy: 'day', metrics: ['receipts', 'gross', 'vat', 'cancelled'], compare: false };
}
