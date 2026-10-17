import { describe, expect, it } from 'vitest';
import { allocateEqual, allocateProportional, computeShares, payable, SplitError } from '../src/split-math.ts';

const crf = {
  lines: [
    { lineNo: 1, total: 680 },
    { lineNo: 2, total: 395 },
    { lineNo: 3, total: 389 },
  ],
  totals: { gross: 1464, tip: 100, rounding: 1 },
};
const two = { participants: [{ userId: 'a', guestName: null }], includeMe: true };
const sum = (a: Array<{ amountMinor: number }>) => a.reduce((s, x) => s + x.amountMinor, 0);

describe('allocateEqual', () => {
  it('shares cents, leftover to the first people', () => {
    expect(allocateEqual(100, 3)).toEqual([34, 33, 33]);
    expect(allocateEqual(0, 3)).toEqual([0, 0, 0]);
  });
  it('handles negative totals (discount lines)', () => {
    expect(allocateEqual(-100, 3)).toEqual([-34, -33, -33]);
  });
  it('always adds up', () => {
    for (const [t, n] of [[1, 7], [999, 4], [-5, 2], [123456, 9]] as const) expect(allocateEqual(t, n).reduce((a, b) => a + b, 0)).toBe(t);
  });
});

describe('allocateProportional', () => {
  it('follows the weights and adds up', () => {
    const r = allocateProportional(101, [3, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(101);
    expect(r[0]).toBeGreaterThan(r[1]!);
  });
  it('falls back to equal for zero weights', () => {
    expect(allocateProportional(5, [0, 0])).toEqual([3, 2]);
  });
  it('handles big numbers without losing cents', () => {
    const r = allocateProportional(99_999_999, [99_999_999, 1, 1]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(99_999_999);
  });
});

describe('computeShares', () => {
  it('equal: everyone pays the same, adds up to the payable total', () => {
    const s = computeShares(crf, { mode: 'equal', ...two });
    expect(s.map((x) => x.who)).toEqual(['me', 'p0']);
    expect(sum(s)).toBe(payable(crf));
  });

  it('equal without me: only the participants pay', () => {
    const s = computeShares(crf, { mode: 'equal', participants: [{ userId: 'a', guestName: null }], includeMe: false });
    expect(s).toHaveLength(1);
    expect(sum(s)).toBe(payable(crf));
  });

  it('items: lines go to their people, tip and rounding follow the subtotals', () => {
    const s = computeShares(crf, {
      mode: 'items',
      ...two,
      assignments: [
        { lineNo: 1, who: ['me'] },
        { lineNo: 2, who: ['p0'] },
        { lineNo: 3, who: ['me', 'p0'] },
      ],
    });
    expect(sum(s)).toBe(payable(crf));
    expect(s[0]!.lineNos).toEqual([1, 3]);
    expect(s[1]!.lineNos).toEqual([2, 3]);
    expect(s[0]!.amountMinor).toBeGreaterThan(s[1]!.amountMinor);
  });

  it('items: refuses an unassigned line and an unknown person', () => {
    expect(() => computeShares(crf, { mode: 'items', ...two, assignments: [{ lineNo: 1, who: ['me'] }] })).toThrow(SplitError);
    expect(() =>
      computeShares(crf, { mode: 'items', ...two, assignments: [{ lineNo: 1, who: ['p9'] }, { lineNo: 2, who: ['me'] }, { lineNo: 3, who: ['me'] }] }),
    ).toThrow(/unknown person/);
  });

  it('items: someone assigned nothing pays nothing', () => {
    const s = computeShares(crf, {
      mode: 'items',
      ...two,
      assignments: [{ lineNo: 1, who: ['me'] }, { lineNo: 2, who: ['me'] }, { lineNo: 3, who: ['me'] }],
    });
    expect(s[1]!.amountMinor).toBe(0);
    expect(s[0]!.amountMinor).toBe(payable(crf));
  });

  it('custom: must add up to the payable total', () => {
    const ok = computeShares(crf, { mode: 'custom', ...two, amounts: [{ who: 'me', amount: 1000 }, { who: 'p0', amount: 565 }] });
    expect(sum(ok)).toBe(1565);
    expect(() => computeShares(crf, { mode: 'custom', ...two, amounts: [{ who: 'me', amount: 1000 }, { who: 'p0', amount: 500 }] })).toThrow(/add up/);
    expect(() => computeShares(crf, { mode: 'custom', ...two, amounts: [{ who: 'me', amount: 1565 }] })).toThrow(/no amount/);
  });
});
