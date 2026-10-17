import type { Interval } from './plans.ts';

/**
 * Billing periods are calendar months or years on the Europe/Amsterdam wall clock: 31 Jan 10:00 + 1 month is
 * 28 (or 29) Feb 10:00 Amsterdam time, 29 Feb + 1 year is 28 Feb. Instants are stored as timestamptz (UTC).
 */
export const BILLING_TIME_ZONE = 'Europe/Amsterdam';

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: BILLING_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

function wallOf(d: Date): Wall {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(d)) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, second: p.second!, ms: d.getUTCMilliseconds() };
}

/** Amsterdam's offset from UTC at an instant, in ms. */
function offsetAt(utcMs: number): number {
  const w = wallOf(new Date(utcMs));
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms) - utcMs;
}

/** The instant of an Amsterdam wall-clock time. A time skipped by the summer-time switch moves forward an hour. */
function fromWall(w: Wall): Date {
  const wall = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, w.ms);
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `start` plus one calendar month (monthly) or one year (annual), clamped to the end of the month. */
export function addInterval(start: Date, interval: Interval): Date {
  const w = wallOf(start);
  const months = interval === 'monthly' ? 1 : 12;
  const index = w.month - 1 + months;
  const year = w.year + Math.floor(index / 12);
  const month = (index % 12) + 1;
  return fromWall({ ...w, year, month, day: Math.min(w.day, daysInMonth(year, month)) });
}

/** The Amsterdam calendar year of an instant (invoice numbers are `LR-<year>-<sequence>`). */
export function amsterdamYear(d: Date): number {
  return wallOf(d).year;
}

/** Whole days left until `end`, rounded up (0 once it has passed). */
export function daysLeft(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
}
