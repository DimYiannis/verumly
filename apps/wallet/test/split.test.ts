import { describe, expect, it } from 'vitest';
import { canSplitByQuantity, parseEuroInput, previewShares, spread } from '../app/utils/split.ts';

describe('spread', () => {
  it('gives leftover cents to the first people and always adds up', () => {
    expect(spread(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(spread(100, [3, 1])).toEqual([75, 25]);
    expect(spread(7, [0, 0])).toEqual([4, 3]);
  });
});

describe('previewShares', () => {
  const lines = [
    { lineNo: 1, total: 500 },
    { lineNo: 2, total: 300 },
  ];
  it('equal', () => {
    const p = previewShares({ payable: 1001, mode: 'equal', people: ['me', 'p0'], lines, assignments: {}, custom: {} });
    expect(p.shares).toEqual({ me: 501, p0: 500 });
    expect(p.valid).toBe(true);
  });
  it('items: shared line splits equally, tip follows in proportion, unassigned blocks', () => {
    const open = previewShares({ payable: 800, mode: 'items', people: ['me', 'p0'], lines, assignments: { 1: ['me'] }, custom: {} });
    expect(open.unassigned).toEqual([2]);
    expect(open.unassignedMinor).toBe(300);
    expect(open.valid).toBe(false);
    const p = previewShares({ payable: 880, mode: 'items', people: ['me', 'p0'], lines, assignments: { 1: ['me'], 2: ['me', 'p0'] }, custom: {} });
    // base me 650, p0 150; 880 * 650/800 = 715
    expect(p.shares).toEqual({ me: 715, p0: 165 });
    expect(p.valid).toBe(true);
  });
  it('custom must add up', () => {
    const p = previewShares({ payable: 800, mode: 'custom', people: ['me', 'p0'], lines, assignments: {}, custom: { me: 500, p0: 200 } });
    expect(p.customDiff).toBe(-100);
    expect(p.valid).toBe(false);
  });
});

describe('parseEuroInput', () => {
  it('accepts comma and dot, rejects junk', () => {
    expect(parseEuroInput('12,5')).toBe(1250);
    expect(parseEuroInput('3.05')).toBe(305);
    expect(parseEuroInput('7')).toBe(700);
    expect(parseEuroInput('-1')).toBeNull();
    expect(parseEuroInput('')).toBeNull();
  });
});

describe('previewShares: items split by quantity', () => {
  const bar = [
    { lineNo: 1, total: 1750, qty: '5' },
    { lineNo: 2, total: 800, qty: '1' },
    { lineNo: 3, total: 333, qty: '3.5' },
  ];
  const base = { payable: 2883, mode: 'items' as const, people: ['me', 'p0'], lines: bar, custom: {} };

  it('5 beers, 2 mine and 3 Anna\'s: the line total follows the units', () => {
    const p = previewShares({ ...base, assignments: { 2: ['me'], 3: ['me', 'p0'] }, units: { 1: { me: 2, p0: 3 } } });
    expect(p.shares).toEqual({ me: 700 + 800 + 167, p0: 1050 + 166 });
    expect(p.valid).toBe(true);
    expect(Object.values(p.shares).reduce((a, b) => a + b, 0)).toBe(2883);
  });

  it('units that do not add up to the quantity keep the line open, with the value of the missing units', () => {
    const p = previewShares({ ...base, assignments: { 2: ['me'], 3: ['me', 'p0'] }, units: { 1: { me: 2, p0: 1 } } });
    expect(p.unassigned).toEqual([1]);
    expect(p.unassignedMinor).toBe(700); // 2 of 5 units
    expect(p.valid).toBe(false);
  });

  it('a line of one unit or a weighed quantity is not split by quantity', () => {
    expect(canSplitByQuantity('5')).toBe(true);
    expect(canSplitByQuantity('2')).toBe(true);
    expect(canSplitByQuantity('1')).toBe(false);
    expect(canSplitByQuantity('3.5')).toBe(false);
    expect(canSplitByQuantity('-2')).toBe(false);
    expect(canSplitByQuantity(undefined)).toBe(false);
  });

  it('matches the server rules for odd cents', () => {
    const p = previewShares({ payable: 1001, mode: 'items', people: ['me', 'p0'], lines: [{ lineNo: 1, total: 1001, qty: '3' }], assignments: {}, units: { 1: { me: 1, p0: 2 } }, custom: {} });
    expect(p.shares.me! + p.shares.p0!).toBe(1001);
    expect(p.shares.me!).toBeLessThan(p.shares.p0!);
  });
});
