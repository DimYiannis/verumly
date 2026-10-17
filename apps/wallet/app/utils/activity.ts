/** Helpers for the friends activity feed. */
import type { MessageKey } from '../i18n/index.ts';

export interface Part {
  text: string;
  bold: boolean;
}

/**
 * Splits a sentence template like "{name} paid you back {amount}" into text parts, bolding the filled-in values
 * (the person, the amount, the shop) the way the design shows them.
 */
export function sentenceParts(template: string, params: Record<string, string>): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: template.slice(last, at), bold: false });
    const value = params[m[1]!];
    parts.push({ text: value ?? m[0], bold: value !== undefined });
    last = at + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last), bold: false });
  return parts;
}

export type ActivityKind = 'friend_added' | 'friend_request' | 'share_received' | 'split_with_me' | 'split_created' | 'paid_you' | 'you_settled' | 'reaction';

export const ACTIVITY_SENTENCE: Record<ActivityKind, MessageKey> = {
  friend_added: 'rcpt.act.friendAdded',
  friend_request: 'rcpt.act.friendRequest',
  share_received: 'rcpt.act.shareReceived',
  split_with_me: 'rcpt.act.splitWithMe',
  split_created: 'rcpt.act.splitCreated',
  paid_you: 'rcpt.act.paidYou',
  you_settled: 'rcpt.act.youSettled',
  reaction: 'rcpt.act.reaction',
};

/** Where a tap on a feed item goes, or null when it goes nowhere. */
export function activityTarget(i: { kind: string; splitId: string | null; shareId: string | null }): { to: string; testid: 'split-open' | 'share-open' } | null {
  if (i.kind === 'friend_request' || i.kind === 'friend_added') return null;
  if (i.shareId && (i.kind === 'share_received' || i.kind === 'reaction')) return { to: `/shared/${i.shareId}`, testid: 'share-open' };
  if (i.splitId) return { to: `/splits/${i.splitId}`, testid: 'split-open' };
  return null;
}
