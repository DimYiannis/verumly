/** Live preview of a split. The server result is the truth; this follows the same rules so the numbers match in the common case. */

export type SplitMode = 'equal' | 'items' | 'custom';

export interface PreviewInput {
  /** totals.gross + totals.tip + totals.rounding, in cents */
  payable: number;
  mode: SplitMode;
  /** who keys in order: 'me' (when included), then 'p0', 'p1', ... */
  people: readonly string[];
  lines: readonly { lineNo: number; total: number }[];
  /** lineNo to the who keys on that line */
  assignments: Readonly<Record<number, readonly string[]>>;
  /** who to cents (custom mode) */
  custom: Readonly<Record<string, number>>;
}

export interface Preview {
  shares: Record<string, number>;
  /** items mode: lines nobody has taken yet */
  unassigned: number[];
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

export function previewShares(input: PreviewInput): Preview {
  const { people, payable } = input;
  const shares: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  const unassigned: number[] = [];
  let customDiff = 0;
  if (people.length === 0) return { shares, unassigned, customDiff, valid: false };

  if (input.mode === 'equal') {
    spread(payable, people.map(() => 1)).forEach((v, i) => (shares[people[i]!] = v));
  } else if (input.mode === 'items') {
    const base: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
    for (const line of input.lines) {
      const who = (input.assignments[line.lineNo] ?? []).filter((w) => w in base);
      if (who.length === 0) {
        unassigned.push(line.lineNo);
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
  return { shares, unassigned, customDiff, valid };
}

/** "12,50" or "12.5" to cents; null when not a valid non-negative amount. */
export function parseEuroInput(raw: string): number | null {
  const m = /^\s*(\d{1,7})(?:[.,](\d{1,2}))?\s*$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}
