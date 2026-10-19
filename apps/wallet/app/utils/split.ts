/** Live preview of a split. The server result is the truth; this follows the same rules so the numbers match in the common case. */

export type SplitMode = 'equal' | 'items' | 'custom';

export interface PreviewInput {
  /** totals.gross + totals.tip + totals.rounding, in cents */
  payable: number;
  mode: SplitMode;
  /** who keys in order: 'me' (when included), then 'p0', 'p1', ... */
  people: readonly string[];
  lines: readonly { lineNo: number; total: number; qty?: string }[];
  /** lineNo to the who keys on that line */
  assignments: Readonly<Record<number, readonly string[]>>;
  /** items mode, lines split by quantity: lineNo to who to the number of units that person takes */
  units?: Readonly<Record<number, Readonly<Record<string, number>>>>;
  /** who to cents (custom mode) */
  custom: Readonly<Record<string, number>>;
}

export interface Preview {
  shares: Record<string, number>;
  /** items mode: lines nobody has taken yet */
  unassigned: number[];
  /** items mode: sum of the line totals nobody has taken yet, in cents */
  unassignedMinor: number;
  /** custom mode: entered amounts minus payable */
  customDiff: number;
  /** false while the form cannot be submitted */
  valid: boolean;
}

/** Spread `amount` over `weights` (proportional, largest remainder, leftover cents to the first). Zero or negative weight sum: evenly. */
export function spread(amount: number, weights: readonly number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  const w = sum > 0 && weights.every((x) => x >= 0) ? weights : weights.map(() => 1);
  const wSum = w.reduce((a, b) => a + b, 0);
  const base = w.map((x) => Math.floor((amount * x) / wSum));
  let left = amount - base.reduce((a, b) => a + b, 0);
  const order = w
    .map((x, i) => ({ i, rem: (amount * x) % wSum }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  return base;
}

/** A whole-number quantity ("5", not "0.35"). */
export function isWhole(qty: string | undefined): boolean {
  return qty !== undefined && /^[1-9]\d{0,3}$/.test(qty);
}

/** A line of 2 or more whole units can be split by quantity (5 beers: 2 mine, 3 yours). */
export function canSplitByQuantity(qty: string | undefined): boolean {
  return isWhole(qty) && Number(qty) >= 2;
}

export function previewShares(input: PreviewInput): Preview {
  const { people, payable } = input;
  const shares: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  const unassigned: number[] = [];
  let unassignedMinor = 0;
  let customDiff = 0;
  if (people.length === 0) return { shares, unassigned, unassignedMinor, customDiff, valid: false };

  if (input.mode === 'equal') {
    spread(payable, people.map(() => 1)).forEach((v, i) => (shares[people[i]!] = v));
  } else if (input.mode === 'items') {
    const base: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
    for (const line of input.lines) {
      const taken = Object.entries(input.units?.[line.lineNo] ?? {}).filter(([w, q]) => w in base && q > 0);
      if (taken.length > 0 && isWhole(line.qty)) {
        const all = Number(line.qty);
        const sum = taken.reduce((a, [, q]) => a + q, 0);
        if (sum !== all) {
          // some units have nobody yet: the line counts as open, with the value of the missing units
          unassigned.push(line.lineNo);
          unassignedMinor += Math.round((line.total * Math.max(0, all - sum)) / all);
          continue;
        }
        spread(line.total, taken.map(([, q]) => q)).forEach((v, i) => (base[taken[i]![0]] = (base[taken[i]![0]] ?? 0) + v));
        continue;
      }
      const who = (input.assignments[line.lineNo] ?? []).filter((w) => w in base);
      if (who.length === 0) {
        unassigned.push(line.lineNo);
        unassignedMinor += line.total;
        continue;
      }
      spread(line.total, who.map(() => 1)).forEach((v, i) => (base[who[i]!] = (base[who[i]!] ?? 0) + v));
    }
    // tip and rounding follow the items in proportion
    spread(payable, people.map((p) => base[p] ?? 0)).forEach((v, i) => (shares[people[i]!] = v));
  } else {
    let total = 0;
    for (const p of people) {
      shares[p] = input.custom[p] ?? 0;
      total += shares[p]!;
    }
    customDiff = total - payable;
  }
  const valid = input.mode === 'items' ? unassigned.length === 0 : input.mode === 'custom' ? customDiff === 0 : true;
  return { shares, unassigned, unassignedMinor, customDiff, valid };
}

/** "12,50" or "12.5" to cents; null when not a valid non-negative amount. */
export function parseEuroInput(raw: string): number | null {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}
