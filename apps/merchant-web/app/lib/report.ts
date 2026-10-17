import type { ReportMetric, ReportSpec } from '@lr/schema';

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
export const isoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function presetRange(p: (typeof PRESETS)[number], now = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = (d: Date) => isoDay(d);
  switch (p) {
    case 'today':
      return { from: day(now), to: day(now) };
    case 'last7':
      return { from: day(new Date(y, m, now.getDate() - 6)), to: day(now) };
    case 'last30':
      return { from: day(new Date(y, m, now.getDate() - 29)), to: day(now) };
    case 'thisMonth':
      return { from: day(new Date(y, m, 1)), to: day(now) };
    case 'lastMonth':
      return { from: day(new Date(y, m - 1, 1)), to: day(new Date(y, m, 0)) };
    case 'quarter':
      return { from: day(new Date(y, Math.floor(m / 3) * 3, 1)), to: day(now) };
    case 'ytd':
      return { from: day(new Date(y, 0, 1)), to: day(now) };
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
