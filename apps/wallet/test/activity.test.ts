import { describe, expect, it } from 'vitest';
import { activityTarget, sentenceParts } from '../app/utils/activity.ts';

describe('sentenceParts', () => {
  it('bolds filled-in values', () => {
    expect(sentenceParts('{name} paid you back {amount}', { name: 'Anna', amount: '€8,00' })).toEqual([
      { text: 'Anna', bold: true },
      { text: ' paid you back ', bold: false },
      { text: '€8,00', bold: true },
    ]);
  });
  it('keeps unknown placeholders and plain text', () => {
    expect(sentenceParts('Hello {who}', {})).toEqual([
      { text: 'Hello ', bold: false },
      { text: '{who}', bold: false },
    ]);
    expect(sentenceParts('plain', {})).toEqual([{ text: 'plain', bold: false }]);
  });
});

describe('activityTarget', () => {
  it('links splits and shares, not friends', () => {
    expect(activityTarget({ kind: 'split_with_me', splitId: 's1', shareId: null })).toEqual({ to: '/splits/s1', testid: 'split-open' });
    expect(activityTarget({ kind: 'share_received', splitId: null, shareId: 'h1' })).toEqual({ to: '/shared/h1', testid: 'share-open' });
    expect(activityTarget({ kind: 'reaction', splitId: null, shareId: 'h1' })?.to).toBe('/shared/h1');
    expect(activityTarget({ kind: 'friend_added', splitId: null, shareId: null })).toBeNull();
    expect(activityTarget({ kind: 'paid_you', splitId: null, shareId: null })).toBeNull();
  });
});
