import type { SplitCreateBody } from '@lr/schema';

/** The parts of a receipt the split needs (a full Crf fits). */
export interface SplittableReceipt {
  /** `qty` is needed only for lines split by quantity */
  lines: Array<{ lineNo: number; total: number; qty?: string }>;
  totals: { gross: number; tip: number; rounding: number };
}

/** Integer-cent allocation for splitting a bill. Pure functions, no I/O: easy to test and the same rules as the wallet preview. */

export class SplitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** `total` cents shared equally between `n` people; the leftover cents go to the first people. Works for negative totals. */
export function allocateEqual(total: number, n: number): number[] {
  if (n < 1) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const rem = abs % n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rem ? 1 : 0)));
}

/** `total` cents shared in proportion to non-negative `weights` (largest remainder, ties to the first). All-zero weights: equal. */
export function allocateProportional(total: number, weights: number[]): number[] {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0);
  if (n === 0) return [];
  if (sum <= 0) return allocateEqual(total, n);
  const sign = total < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(total));
  const s = BigInt(sum);
  const parts = weights.map((w, i) => {
    const exact = abs * BigInt(w);
    return { i, floor: exact / s, rem: exact % s };
  });
  let left = abs - parts.reduce((a, p) => a + p.floor, 0n);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  const extra = new Set<number>();
  for (const p of order) {
    if (left <= 0n) break;
    extra.add(p.i);
    left -= 1n;
  }
  return parts.map((p) => Number(sign * (p.floor + (extra.has(p.i) ? 1n : 0n))));
}

export interface PersonShare {
  /** 'me' or 'p<index>' */
  who: string;
  amountMinor: number;
  lineNos: number[];
  /** lines this person took only some units of (a split by quantity) */
  lineUnits: Array<{ lineNo: number; qty: number }>;
}

/**
 * How a share's lines are stored in `split_shares.line_nos` (jsonb, no migration): a plain line number for a whole line or an equal
 * share of it, `{ n, q }` for `q` units of line `n`. Older rows only have numbers.
 */
export type LineRef = number | { n: number; q: number };

export function encodeLineRefs(share: Pick<PersonShare, 'lineNos' | 'lineUnits'>): LineRef[] {
  const units = new Map(share.lineUnits.map((u) => [u.lineNo, u.qty]));
  return share.lineNos.map((n) => (units.has(n) ? { n, q: units.get(n)! } : n));
}

export function decodeLineRefs(stored: unknown): Pick<PersonShare, 'lineNos' | 'lineUnits'> {
  const lineNos: number[] = [];
  const lineUnits: PersonShare['lineUnits'] = [];
  for (const r of Array.isArray(stored) ? stored : []) {
    if (typeof r === 'number') lineNos.push(r);
    else if (typeof r === 'object' && r !== null && 'n' in r && 'q' in r && typeof r.n === 'number' && typeof r.q === 'number') {
      lineNos.push(r.n);
      lineUnits.push({ lineNo: r.n, qty: r.q });
    }
  }
  return { lineNos, lineUnits };
}

/** What the people of a split pay in total: items plus tip plus rounding. */
export function payable(crf: Pick<SplittableReceipt, 'totals'>): number {
  return crf.totals.gross + crf.totals.tip + crf.totals.rounding;
}

/** Everyone in the split, creator first (when included), then the participants in the order given. */
export function peopleOf(body: Pick<SplitCreateBody, 'participants' | 'includeMe'>): string[] {
  return [...(body.includeMe ? ['me'] : []), ...body.participants.map((_, i) => `p${i}`)];
}

/**
 * The share of every person for `body` on `crf`. Throws SplitError for an invalid request (unknown person, unassigned line,
 * custom amounts that do not add up). The result always adds up to `payable(crf)`.
 */
export function computeShares(crf: SplittableReceipt, body: Pick<SplitCreateBody, 'mode' | 'participants' | 'includeMe' | 'assignments' | 'amounts'>): PersonShare[] {
  const people = peopleOf(body);
  if (people.length === 0) throw new SplitError('no_people', 'nobody takes part in this split');
  const known = new Set(people);
  const due = payable(crf);

  if (body.mode === 'equal') {
    const amounts = allocateEqual(due, people.length);
    return people.map((who, i) => ({ who, amountMinor: amounts[i]!, lineNos: [], lineUnits: [] }));
  }

  if (body.mode === 'custom') {
    const given = new Map<string, number>();
    for (const a of body.amounts ?? []) {
      if (!known.has(a.who)) throw new SplitError('unknown_person', `unknown person ${a.who}`);
      if (given.has(a.who)) throw new SplitError('duplicate_person', `${a.who} appears twice`);
      given.set(a.who, a.amount);
    }
    for (const who of people) if (!given.has(who)) throw new SplitError('missing_amount', `no amount for ${who}`);
    const sum = [...given.values()].reduce((a, b) => a + b, 0);
    if (sum !== due) throw new SplitError('amounts_mismatch', `amounts add up to ${sum}, the receipt is ${due}`);
    return people.map((who) => ({ who, amountMinor: given.get(who)!, lineNos: [], lineUnits: [] }));
  }

  // items: every line goes to the people it is assigned to (equally, or by quantity), tip and rounding follow the subtotals
  const byLine = new Map<number, { who: string[]; units?: Array<{ who: string; qty: number }> }>();
  for (const a of body.assignments ?? []) {
    const who = [...new Set(a.who)];
    for (const w of who) if (!known.has(w)) throw new SplitError('unknown_person', `unknown person ${w}`);
    for (const u of a.units ?? []) if (!known.has(u.who)) throw new SplitError('unknown_person', `unknown person ${u.who}`);
    byLine.set(a.lineNo, { who, units: a.units });
  }
  const sub = new Map<string, number>(people.map((p) => [p, 0]));
  const lineNos = new Map<string, number[]>(people.map((p) => [p, []]));
  const lineUnits = new Map<string, PersonShare['lineUnits']>(people.map((p) => [p, []]));
  for (const line of crf.lines) {
    const assigned = byLine.get(line.lineNo);
    if (!assigned) throw new SplitError('line_unassigned', `line ${line.lineNo} is not assigned to anyone`);
    if (assigned.units) {
      const wanted = new Set<string>();
      for (const u of assigned.units) {
        if (wanted.has(u.who)) throw new SplitError('duplicate_person', `${u.who} appears twice on line ${line.lineNo}`);
        wanted.add(u.who);
      }
      if (line.qty === undefined || !/^[1-9]\d{0,3}$/.test(line.qty)) throw new SplitError('units_not_whole', `line ${line.lineNo} cannot be split by quantity`);
      const total = assigned.units.reduce((a, u) => a + u.qty, 0);
      if (total !== Number(line.qty)) throw new SplitError('units_mismatch', `line ${line.lineNo} has ${line.qty} units, ${total} are assigned`);
      const parts = allocateProportional(line.total, assigned.units.map((u) => u.qty));
      assigned.units.forEach((u, i) => {
        sub.set(u.who, sub.get(u.who)! + parts[i]!);
        lineNos.get(u.who)!.push(line.lineNo);
        lineUnits.get(u.who)!.push({ lineNo: line.lineNo, qty: u.qty });
      });
      continue;
    }
    const parts = allocateEqual(line.total, assigned.who.length);
    assigned.who.forEach((w, i) => {
      sub.set(w, sub.get(w)! + parts[i]!);
      lineNos.get(w)!.push(line.lineNo);
    });
  }
  for (const lineNo of byLine.keys()) if (!crf.lines.some((l) => l.lineNo === lineNo)) throw new SplitError('unknown_line', `no line ${lineNo} on this receipt`);
  const extras = allocateProportional(crf.totals.tip + crf.totals.rounding, people.map((p) => Math.max(0, sub.get(p)!)));
  return people.map((who, i) => ({ who, amountMinor: sub.get(who)! + extras[i]!, lineNos: lineNos.get(who)!, lineUnits: lineUnits.get(who)! }));
}
