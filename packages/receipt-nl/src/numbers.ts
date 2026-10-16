/** Dutch number parsing for OCR output. All money is returned as integer euro-cents. */

/**
 * `1.234,56` → 123456, `-3,50` → -350, `3,50-` → -350, `€ 12,5` → 1250, `12.50` → 1250 (English decimal,
 * only when exactly 1–2 digits follow the dot), `1.234` → 123400 (thousands separator).
 * A JSON number is taken as euros. Returns null when the text is not a single amount.
 */
export function parseCents(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  if (typeof value !== 'string') return null;
  let s = value.replace(/€|eur(o)?\b/gi, '').replace(/\s+/g, '');
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.endsWith('-')) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1);
  }
  let whole: string;
  let frac = '';
  if (s.includes(',')) {
    const m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(s);
    if (!m) return null;
    whole = m[1]!.replace(/\./g, '');
    frac = m[2]!;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    const [w, f] = s.split('.');
    whole = w!;
    frac = f!;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s) || /^\d+$/.test(s)) {
    whole = s.replace(/\./g, '');
  } else {
    return null;
  }
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return neg ? -cents : cents;
}

/**
 * Quantity as the CRF decimal string (≤ 3 decimals, `.` separator): `2` → `2`, `0,412 kg` → `0.412`,
 * `-1` → `-1`, `2x` → `2`. null (not printed) means 1. Returns undefined for something unparseable
 * or with more than 3 decimals.
 */
export function parseQty(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return '1';
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  if (raw === null) return undefined;
  const m = /^\s*(-?)\s*(\d{1,7})(?:[.,](\d+))?\s*(?:x|×|st|stuks?|kg|g|gr|l|ltr)?\s*$/i.exec(raw);
  if (!m) return undefined;
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > 3) return undefined;
  const sign = m[1] === '-' && (Number(m[2]) !== 0 || frac !== '') ? '-' : '';
  return `${sign}${Number(m[2])}${frac ? `.${frac}` : ''}`;
}

/** `9`, `9%`, `21,0 %`, 21 → 21 | 9 | 0; anything else → null. */
export function parseVatRate(value: unknown): 21 | 9 | 0 | null {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const m = /^\s*(\d{1,2})(?:[.,]0+)?\s*%?\s*$/.exec(raw);
  if (!m) return null;
  const n = Number(m[1]);
  return n === 21 || n === 9 || n === 0 ? n : null;
}
