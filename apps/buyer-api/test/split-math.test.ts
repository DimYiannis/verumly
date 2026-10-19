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

describe('items split by quantity (5 beers: 2 mine, 3 Anna\'s)', () => {
  const bar = {
    lines: [
      { lineNo: 1, total: 1750, qty: '5' }, // 5 beers at 3,50
      { lineNo: 2, total: 800, qty: '1' }, // one pizza
      { lineNo: 3, total: 333, qty: '3.5' }, // by weight: cannot be split by quantity
    ],
    totals: { gross: 2883, tip: 0, rounding: 0 },
  };
  const rest = [
    { lineNo: 2, who: ['me'] },
    { lineNo: 3, who: ['me', 'p0'] },
  ];

  it('the line total follows the units; the rest of the bill is as before', () => {
    const r = computeShares(bar, { ...two, mode: 'items', assignments: [{ lineNo: 1, who: ['me', 'p0'], units: [{ who: 'me', qty: 2 }, { who: 'p0', qty: 3 }] }, ...rest] });
    expect(r.map((s) => s.amountMinor)).toEqual([700 + 800 + 167, 1050 + 166]);
    expect(sum(r)).toBe(payable(bar));
    expect(r[0]!.lineUnits).toEqual([{ lineNo: 1, qty: 2 }]);
    expect(r[1]!.lineUnits).toEqual([{ lineNo: 1, qty: 3 }]);
    expect(r[0]!.lineNos).toEqual([1, 2, 3]);
  });

  it('unequal units give unequal cents, odd cents never get lost', () => {
    const odd = { lines: [{ lineNo: 1, total: 1001, qty: '3' }], totals: { gross: 1001, tip: 0, rounding: 0 } };
    const r = computeShares(odd, { ...two, mode: 'items', assignments: [{ lineNo: 1, who: ['me', 'p0'], units: [{ who: 'me', qty: 1 }, { who: 'p0', qty: 2 }] }] });
    expect(sum(r)).toBe(1001);
    expect(r[0]!.amountMinor).toBeLessThan(r[1]!.amountMinor);
  });

  it('tip and rounding follow the subtotals as usual', () => {
    const tipped = { ...bar, totals: { gross: 2883, tip: 300, rounding: -3 } };
    const r = computeShares(tipped, { ...two, mode: 'items', assignments: [{ lineNo: 1, who: ['me', 'p0'], units: [{ who: 'me', qty: 2 }, { who: 'p0', qty: 3 }] }, ...rest] });
    expect(sum(r)).toBe(payable(tipped));
  });

  it('refuses units that do not add up to the quantity, repeat a person, or sit on a line that has no whole quantity', () => {
    const ass = (units: Array<{ who: string; qty: number }>, lineNo = 1) => [{ lineNo, who: [...new Set(units.map((u) => u.who))], units }];
    const run = (a: ReturnType<typeof ass>) => () => computeShares(bar, { ...two, mode: 'items', assignments: [...a, ...[{ lineNo: 1, who: ['me'] }, ...rest].filter((r) => r.lineNo !== a[0]!.lineNo)] });
    expect(run(ass([{ who: 'me', qty: 2 }, { who: 'p0', qty: 2 }]))).toThrow(/units_mismatch|4 are assigned/);
    expect(run(ass([{ who: 'me', qty: 3 }, { who: 'p0', qty: 3 }]))).toThrow(SplitError);
    expect(run(ass([{ who: 'me', qty: 2 }, { who: 'me', qty: 3 }]))).toThrow(/appears twice/);
    expect(run(ass([{ who: 'p9', qty: 5 }]))).toThrow(/unknown person/);
    expect(run(ass([{ who: 'me', qty: 3 }, { who: 'p0', qty: 1 }], 3))).toThrow(/cannot be split by quantity/);
  });

  it('a line can still be shared equally without units, next to a line split by quantity', () => {
    const r = computeShares(bar, { ...two, mode: 'items', assignments: [{ lineNo: 1, who: ['me', 'p0'] }, ...rest] });
    expect(sum(r)).toBe(payable(bar));
    expect(r[0]!.lineUnits).toEqual([]);
  });
});

describe('line refs in storage', () => {
  it('round-trip, and old rows (plain numbers) still read', async () => {
    const { encodeLineRefs, decodeLineRefs } = await import('../src/split-math.ts');
    const share = { lineNos: [1, 2, 3], lineUnits: [{ lineNo: 1, qty: 2 }] };
    expect(encodeLineRefs(share)).toEqual([{ n: 1, q: 2 }, 2, 3]);
    expect(decodeLineRefs(encodeLineRefs(share))).toEqual(share);
    expect(decodeLineRefs([4, 5])).toEqual({ lineNos: [4, 5], lineUnits: [] });
    expect(decodeLineRefs(null)).toEqual({ lineNos: [], lineUnits: [] });
  });
});
