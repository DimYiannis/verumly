import { describe, expect, it } from 'vitest';
import { avatarColour, budgetProgress, dayPart, initials, logoColour, parseBudgetInput, percentChange, sparkPoints } from '../app/utils/home.ts';

describe('home helpers', () => {
  it('derives initials', () => {
    expect(initials('Café Het Plein')).toBe('CH');
    expect(initials('Sam')).toBe('SA');
    expect(initials('@anna_b')).toBe('AB');
    expect(initials('  ')).toBe('?');
  });
  it('colours are deterministic and case-insensitive', () => {
    expect(logoColour('Bakkerij Zonnig')).toBe(logoColour(' bakkerij zonnig '));
    expect(avatarColour('x')).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('computes percent change', () => {
    expect(percentChange(112, 100)).toBe(12);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
  it('computes budget progress', () => {
    expect(budgetProgress(42800, 60000)).toEqual({ pct: 71, over: false });
    expect(budgetProgress(70000, 60000)).toEqual({ pct: 100, over: true });
    expect(budgetProgress(1, 0)).toEqual({ pct: 0, over: false });
  });
  it('parses the budget input', () => {
    expect(parseBudgetInput('600')).toBe(60000);
    expect(parseBudgetInput('12,5')).toBe(1250);
    expect(parseBudgetInput('0')).toBeNull();
    expect(parseBudgetInput('abc')).toBeNull();
  });
  it('builds sparkline points', () => {
    expect(sparkPoints([], 100, 20)).toBeNull();
    const s = sparkPoints([100, 0, 100], 100, 20);
    expect(s?.line.split(' ')).toHaveLength(3);
    expect(s?.line.endsWith('100,4')).toBe(true);
  });
  it('buckets the day', () => {
    expect([dayPart(8), dayPart(14), dayPart(20)]).toEqual(['morning', 'afternoon', 'evening']);
  });
});
