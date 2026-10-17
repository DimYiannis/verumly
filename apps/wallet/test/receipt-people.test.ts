import { describe, expect, it } from 'vitest';
import { describeShare, openAmount, splitHeadline, type ShareRow } from '../app/utils/receipt-people.ts';

const rows: ShareRow[] = [
  { id: '1', name: 'You', amountMinor: 535, settled: true, isMe: true, lineNos: [] },
  { id: '2', name: 'Anna', amountMinor: 534, settled: false, isMe: false, lineNos: [] },
  { id: '3', name: 'Bram', amountMinor: 100, settled: true, isMe: false, lineNos: [] },
];

describe('receipt people', () => {
  it('sums only unsettled shares', () => {
    expect(openAmount(rows)).toBe(534);
    expect(openAmount([])).toBe(0);
  });
  it('names who owes the creator', () => {
    expect(splitHeadline(rows, true).names).toEqual(['Anna']);
  });
  it('names the participant themselves when they owe', () => {
    const mine = rows.map((r) => (r.id === '1' ? { ...r, settled: false } : r));
    expect(splitHeadline(mine, false).names).toEqual(['You']);
    expect(splitHeadline(rows, false).names).toEqual([]);
  });
  it('describes a share by lines or falls back', () => {
    expect(describeShare(['Koffie ×1', 'Bier ×1'], 'Equal')).toBe('Koffie ×1, Bier ×1');
    expect(describeShare([], 'Equal')).toBe('Equal');
  });
});
