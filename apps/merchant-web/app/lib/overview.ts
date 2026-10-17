/** Pure helpers for the live-operations overview. Kept free of Nuxt auto-imports so vitest can load them. */

export const TIME_ZONE = 'Europe/Amsterdam';
export const ONLINE_MS = 5 * 60_000;
export const LATE_MS = 10 * 60_000;
export const USUAL_WEEKS = 4;

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface AmsterdamNow {
  /** YYYY-MM-DD in Europe/Amsterdam */
  ymd: string;
  /** 0-23 in Europe/Amsterdam */
  hour: number;
  /** ISO weekday, Monday = 1 */
  isoWeekday: number;
}

/** "Now" in Amsterdam, independent of the browser time zone. */
export function amsterdamNow(date: Date): AmsterdamNow {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { ymd: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, isoWeekday: WEEKDAYS[get('weekday')] ?? 1 };
}

/** Add whole days to a YYYY-MM-DD string (calendar arithmetic, no time zone involved). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** How many days with this ISO weekday lie in [from, to] inclusive. */
export function countWeekday(from: string, to: string, isoWeekday: number): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay() || 7;
    if (wd === isoWeekday) n++;
  }
  return n;
}

interface HourRow { key: string; values: { gross?: number } }

/** Per-hour gross (24 slots) from report rows grouped by hour; each slot is divided by `divisor`. */
export function hourlyGross(rows: readonly HourRow[], divisor = 1): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  for (const r of rows) {
    const h = Number(r.key);
    if (Number.isInteger(h) && h >= 0 && h < 24) out[h] = (r.values.gross ?? 0) / Math.max(divisor, 1);
  }
  return out;
}

/** Running total: slot h holds everything sold up to and including hour h. */
export function cumulative(perHour: readonly number[]): number[] {
  let sum = 0;
  return perHour.map((v) => (sum += v));
}

export function isOnline(lastSeenAt: string | null, nowMs: number): boolean {
  return !!lastSeenAt && nowMs - new Date(lastSeenAt).getTime() < ONLINE_MS;
}

/** A receipt is late when the platform got it more than 10 minutes after the till closed it. */
export function isLate(r: { receivedAt: string; createdAt: string }): boolean {
  return new Date(r.receivedAt).getTime() - new Date(r.createdAt).getTime() > LATE_MS;
}
