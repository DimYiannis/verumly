import { describe, expect, it } from 'vitest';
import { parseEuroInput, previewShares, spread } from '../app/utils/split.ts';

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
