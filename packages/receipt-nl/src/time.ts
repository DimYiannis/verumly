const AMS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Amsterdam's UTC offset in ms at the given instant (+1h CET, +2h CEST). */
function amsterdamOffsetMs(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of AMS.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Converts a wall-clock time printed on a Dutch receipt (Europe/Amsterdam) to an ISO UTC string.
 * Ambiguous times (the repeated hour when summer time ends) resolve to the first occurrence (CEST);
 * times that do not exist (the skipped hour when summer time starts) and invalid dates return null.
 */
export function amsterdamLocalToUtc(y: number, mo: number, d: number, h: number, mi: number, s = 0): string | null {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  // the wall time was printed under the offset in force the day before or the day after (they differ only at a switch)
  const candidates = [amsterdamOffsetMs(wall - 86_400_000), amsterdamOffsetMs(wall + 86_400_000)]
    .map((off) => ({ off, utc: wall - off }))
    .filter(({ off, utc }) => amsterdamOffsetMs(utc) === off)
    .map(({ utc }) => utc);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates)).toISOString().replace('.000Z', 'Z');
}

/**
 * Parses a printed date (`10-10-2026`, `10/10/26`, `10.10.2026`, `2026-10-10`) and time (`20:47`, `20:47:05`)
 * into ISO UTC. Returns null when either does not parse or the local time does not exist.
 */
export function printedToUtc(date: string, time: string): string | null {
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!t) return null;
  const dm = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(date.trim());
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  let y: number, mo: number, d: number;
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else if (dm) {
    d = Number(dm[1]);
    mo = Number(dm[2]);
    y = dm[3]!.length === 2 ? 2000 + Number(dm[3]) : Number(dm[3]);
  } else {
    return null;
  }
  return amsterdamLocalToUtc(y, mo, d, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
}
