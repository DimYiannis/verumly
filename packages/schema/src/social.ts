import { z } from 'zod';
import { crf, uuidString } from './crf.ts';
import { receiptTemplate } from './template.ts';

/**
 * Buyer-side social features: profile, friends, invites, sharing a receipt with a friend, splitting a bill.
 * Everything lives in `buyer.*` and is never reachable from the merchant side. Money is integer cents (EUR).
 * No payments: a split only tracks who owes whom, and people mark shares as settled by hand.
 */

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const MAX_SPLIT_PARTICIPANTS = 10;
export const REACTIONS = ['❤️', '😂', '😮', '👍', '😋'] as const;

/** What a friend may see of a person. Never the e-mail address. */
export const publicUser = z.object({
  userId: uuidString,
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  avatar: z.string().nullable(),
});
export type PublicUser = z.infer<typeof publicUser>;

export const profile = publicUser.extend({ email: z.string() });
export type Profile = z.infer<typeof profile>;

export const profileBody = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    handle: z.string().regex(HANDLE_RE, 'handle: 3 to 20 characters: a-z, 0-9, underscore'),
    /** one emoji or short token chosen in the app */
    avatar: z.string().trim().min(1).max(8).nullable().default(null),
  })
  .strict();
export type ProfileBody = z.infer<typeof profileBody>;

// ---------------------------------------------------------------- friends and invites

export const friendRequestBody = z.object({ handle: z.string().regex(HANDLE_RE) }).strict();

export const friendsResponse = z.object({
  friends: z.array(publicUser),
  incoming: z.array(z.object({ requestId: uuidString, from: publicUser })),
  outgoing: z.array(z.object({ requestId: uuidString, to: publicUser })),
});
export type FriendsResponse = z.infer<typeof friendsResponse>;

export const inviteCreated = z.object({ code: z.string(), expiresAt: z.string() });
export const inviteAcceptBody = z.object({ code: z.string().min(16).max(64) }).strict();
export const inviteAcceptResult = z.object({ friend: publicUser, splitId: uuidString.nullable() });

// ---------------------------------------------------------------- shares

export const shareCreateBody = z.object({ receiptId: uuidString, friendId: uuidString }).strict();
export const reactionBody = z.object({ emoji: z.enum(REACTIONS).nullable() }).strict();

export const shareItem = z.object({
  id: uuidString,
  from: publicUser,
  receiptId: uuidString,
  merchantName: z.string(),
  total: z.number().int(),
  currency: z.string(),
  sharedAt: z.string(),
  myReaction: z.enum(REACTIONS).nullable(),
});
export const shareList = z.object({ incoming: z.array(shareItem), outgoing: z.array(shareItem.extend({ to: publicUser })) });
export const shareDetail = z.object({
  share: shareItem,
  receipt: crf,
  template: receiptTemplate.nullable().default(null),
  reactions: z.array(z.object({ user: publicUser, emoji: z.enum(REACTIONS) })),
});
export type ShareItem = z.infer<typeof shareItem>;
export type ShareDetail = z.infer<typeof shareDetail>;

// ---------------------------------------------------------------- splits

export const SPLIT_MODES = ['equal', 'items', 'custom'] as const;

/** A person in a split, besides the creator: a registered user, or a guest who gets an invite link. Exactly one is set. */
export const splitParticipant = z
  .object({ userId: uuidString.nullable().default(null), guestName: z.string().trim().min(1).max(40).nullable().default(null) })
  .strict()
  .refine((p) => (p.userId === null) !== (p.guestName === null), 'exactly one of userId or guestName');

/**
 * `who` references: 'me' (the creator) or 'p0', 'p1', ... (index into `participants`).
 * equal: every person (and the creator when `includeMe`) pays the same.
 * items: each receipt line is assigned to one or more people (`assignments`); a line with several people is split between them.
 * custom: explicit `amounts` that must add up to the payable total.
 * Tip and rounding are spread in proportion in every mode.
 */
export const splitCreateBody = z
  .object({
    receiptId: uuidString,
    mode: z.enum(SPLIT_MODES),
    participants: z.array(splitParticipant).min(1).max(MAX_SPLIT_PARTICIPANTS),
    includeMe: z.boolean().default(true),
    assignments: z.array(z.object({ lineNo: z.number().int().min(1), who: z.array(z.string().regex(/^(me|p\d{1,2})$/)).min(1).max(11) }).strict()).max(500).optional(),
    amounts: z.array(z.object({ who: z.string().regex(/^(me|p\d{1,2})$/), amount: z.number().int().min(0).max(100_000_000) }).strict()).max(11).optional(),
  })
  .strict();
export type SplitCreateBody = z.infer<typeof splitCreateBody>;

export const splitShare = z.object({
  id: uuidString,
  who: publicUser.nullable(),
  guestName: z.string().nullable(),
  amountMinor: z.number().int(),
  settled: z.boolean(),
  settledAt: z.string().nullable(),
  isMe: z.boolean(),
  lineNos: z.array(z.number().int()),
  /** invite code of a guest slot, shown to the creator only */
  inviteCode: z.string().nullable(),
});

export const splitDetail = z.object({
  id: uuidString,
  receiptId: uuidString,
  creator: publicUser,
  creatorIsMe: z.boolean(),
  mode: z.enum(SPLIT_MODES),
  totalMinor: z.number().int(),
  currency: z.string(),
  createdAt: z.string(),
  shares: z.array(splitShare),
  receipt: crf,
  template: receiptTemplate.nullable().default(null),
});
export type SplitDetail = z.infer<typeof splitDetail>;

export const splitListItem = z.object({
  id: uuidString,
  receiptId: uuidString,
  merchantName: z.string(),
  createdAt: z.string(),
  totalMinor: z.number().int(),
  creator: publicUser,
  creatorIsMe: z.boolean(),
  /** my share, in cents (the creator's own share when I created it) */
  myShareMinor: z.number().int(),
  /** unsettled cents: for the creator what others still owe, for a participant what I still owe */
  openMinor: z.number().int(),
});
export const splitList = z.object({ splits: z.array(splitListItem) });

export const settleBody = z.object({ settled: z.boolean() }).strict();

export const balanceRow = z.object({
  user: publicUser,
  /** cents this friend still owes me */
  owesMe: z.number().int(),
  /** cents I still owe this friend */
  iOwe: z.number().int(),
});
export const balances = z.object({ friends: z.array(balanceRow), totalOwedToMe: z.number().int(), totalIOwe: z.number().int() });
export type Balances = z.infer<typeof balances>;
