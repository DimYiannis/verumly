/** Pure helpers for the home screen and the shared avatar / merchant-logo look. */

const LOGO_COLOURS = ['#3338B8', '#2F6B3E', '#8A3225', '#7A5A10', '#1C1F6E', '#5A5FD0', '#6B3F7A', '#1F6B6B'] as const;
const AVATAR_COLOURS = ['#3338B8', '#5A5FD0', '#2F6B3E', '#8A3225', '#6B3F7A', '#1F6B6B'] as const;

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** Up to two initials: first letters of the first two words ("Café Het Plein" -> "CH"), or the first two letters of a single word. */
export function initials(name: string): string {
  const words = name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = (w: string) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ''));
  const first = words[0] ? letters(words[0]) : [];
  if (first.length === 0) return '?';
  const second = words[1] ? letters(words[1]) : [];
  const out = second.length > 0 ? `${first[0]}${second[0]}` : first.slice(0, 2).join('');
  return out.toUpperCase();
}

/** Deterministic colour for a merchant logo square. */
export function logoColour(name: string): string {
  return LOGO_COLOURS[hash(name.trim().toLowerCase()) % LOGO_COLOURS.length] ?? LOGO_COLOURS[0];
}

/** Deterministic colour for an initials avatar. */
export function avatarColour(name: string): string {
  return AVATAR_COLOURS[hash(name.trim().toLowerCase()) % AVATAR_COLOURS.length] ?? AVATAR_COLOURS[0];
}

/** Percent change of `current` against `previous`; null when there is nothing to compare with. Rounded to a whole percent. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Budget bar: share spent (0..100, capped) and whether the budget is exceeded. */
export function budgetProgress(spentCents: number, budgetCents: number): { pct: number; over: boolean } {
  if (budgetCents <= 0) return { pct: 0, over: false };
  return { pct: Math.min(100, Math.round((spentCents / budgetCents) * 100)), over: spentCents > budgetCents };
}

/** Whole euros typed by the user ("600", "600,50") as cents, or null when not a positive amount. */
export function parseBudgetInput(value: string): number | null {
  const m = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return cents > 0 ? cents : null;
}

/** Cumulative series of the daily spend, as SVG polyline points in a `w` x `h` box. Needs at least one day. */
export function sparkPoints(daily: number[], w: number, h: number, pad = 4): { line: string; area: string } | null {
  if (daily.length === 0) return null;
  const cumulative: number[] = [];
  let sum = 0;
  for (const d of daily) {
    sum += Math.max(0, d);
    cumulative.push(sum);
  }
  const max = Math.max(1, ...cumulative);
  const step = cumulative.length > 1 ? w / (cumulative.length - 1) : 0;
  const pts = cumulative.map((v, i) => `${Math.round(i * step * 10) / 10},${Math.round((h - pad - ((h - 2 * pad) * v) / max) * 10) / 10}`);
  if (pts.length === 1) pts.push(`${w},${pts[0]?.split(',')[1] ?? h}`);
  const line = pts.join(' ');
  return { line, area: `${line} ${w},${h} 0,${h}` };
}

/** "Good morning/afternoon/evening" bucket by local hour. */
export function dayPart(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  return hour < 18 ? 'afternoon' : 'evening';
}
