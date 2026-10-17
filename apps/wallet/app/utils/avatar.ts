/** Deterministic avatar helpers: initials and a stable colour derived from a name. */

/** Up to two letters: first letters of the first two words, or the first two letters of a single word. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return '?';
  const letters = (w: string) => Array.from(w.replace(/[^\p{L}\p{N}]/gu, ''));
  const first = letters(words[0]!);
  const second = words[1] ? letters(words[1]) : first.slice(1);
  return (first[0]! + (second[0] ?? '')).toUpperCase();
}

/** Strong colours with enough contrast for white text (merchant logos). */
export const LOGO_COLORS = ['#3338B8', '#2F6B3E', '#8A3225', '#6A4E0E', '#1C1F6E', '#0F6E7A', '#7A2E6E', '#4A5568'] as const;

/** Soft person tones: background, border and text, matching the design book (a to d). */
export const PERSON_TONES = [
  { bg: '#E6E7F8', border: '#B3B6EE', fg: '#1C1F6E' },
  { bg: '#DDECE3', border: '#B9D8BF', fg: '#23552F' },
  { bg: '#F7EED6', border: '#E6D29C', fg: '#6A4E0E' },
  { bg: '#F9E9E4', border: '#EBC2B8', fg: '#8A3225' },
] as const;

function hash(text: string): number {
  let h = 5381;
  for (const ch of text.trim().toLowerCase()) h = (h * 33 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

export function logoColor(name: string): string {
  return LOGO_COLORS[hash(name) % LOGO_COLORS.length]!;
}

export function personTone(name: string): (typeof PERSON_TONES)[number] {
  return PERSON_TONES[hash(name) % PERSON_TONES.length]!;
}
