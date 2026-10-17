/** Response shapes of buyer-api as the wallet consumes them. Parsed at the boundary, so no casts downstream. */
import { z } from 'zod';
import { crf, parsedLine, receiptPreview, receiptTemplate, UPLOAD_STATUSES, type CreateUploadBody } from '@lr/schema';

export const receiptVersion = z.object({
  version: z.number().int(),
  state: z.string(),
  createdAt: z.string(),
  crf,
});
export type ReceiptVersion = z.infer<typeof receiptVersion>;

export const receiptDetail = z.object({ receipt: crf, final: z.boolean(), template: receiptTemplate.nullable().default(null), versions: z.array(receiptVersion) });
export type ReceiptDetail = z.infer<typeof receiptDetail>;

export const resolveView = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ok'), preview: receiptPreview, receipt: crf, final: z.boolean(), template: receiptTemplate.nullable().default(null), versions: z.array(receiptVersion) }),
]);
export type ResolveView = z.infer<typeof resolveView>;

export const claimResult = z.object({ receiptId: z.string(), status: z.enum(['claimed', 'already_yours']) });

export const receiptListItem = z.object({
  receiptId: z.string(),
  merchantName: z.string(),
  locationName: z.string(),
  total: z.number().int(),
  currency: z.string(),
  createdAt: z.string(),
  claimedAt: z.string(),
  source: z.string(),
  state: z.string(),
  version: z.number().int(),
  final: z.boolean(),
});
export type ReceiptListItem = z.infer<typeof receiptListItem>;

export const receiptList = z.object({ items: z.array(receiptListItem), nextCursor: z.string().nullable() });

export const sessionResult = z.object({ token: z.string(), userId: z.string() });

export const consents = z.object({ analytics: z.boolean(), marketing: z.boolean(), push: z.boolean() });
export type Consents = z.infer<typeof consents>;
export const consentsResponse = z.object({ consents: consents });

export const vapidResponse = z.object({ publicKey: z.string().nullable() });
export const pushSubscriptionResult = z.object({ id: z.string() });

export const insights = z.object({
  perMonth: z.array(z.object({ month: z.string(), total: z.number() })),
  perCategory: z.array(z.object({ category: z.string(), total: z.number() })),
  topMerchants: z.array(z.object({ merchantName: z.string(), total: z.number(), count: z.number() })),
});
export type Insights = z.infer<typeof insights>;

export const uploadDraft = z.object({
  merchantName: z.string().nullable(),
  printedAt: z.string().nullable(),
  gross: z.number().nullable(),
  rounding: z.number().optional(),
  lines: z.array(parsedLine),
  vatBreakdown: z.array(z.object({ rate: z.number(), base: z.number().nullable(), vat: z.number() })).optional(),
  paymentMethod: z.string().nullable().optional(),
});
export type UploadDraft = z.infer<typeof uploadDraft>;

export const uploadStatus = z.object({
  uploadId: z.string(),
  status: z.enum(UPLOAD_STATUSES),
  failures: z.array(z.string()),
  draft: uploadDraft.nullable(),
  matchedReceiptId: z.string().nullable(),
  match: z.object({ receiptId: z.string(), merchantName: z.string(), total: z.number(), createdAt: z.string() }).nullable(),
  createdAt: z.string(),
});
export type UploadStatus = z.infer<typeof uploadStatus>;

export const uploadList = z.object({ items: z.array(uploadStatus) });
export const presignResult = z.object({ uploadId: z.string(), uploadUrl: z.string(), headers: z.record(z.string(), z.string()).default({}) });
export const completeResult = z.object({ uploadId: z.string(), status: z.string() });
export const acceptMatchResult = z.object({ receiptId: z.string() });

export type UploadContentType = CreateUploadBody['contentType'];

export interface ReceiptFilters {
  q?: string;
  state?: 'presented' | 'paid' | 'void';
  from?: string;
  to?: string;
  category?: string;
  merchant?: string;
}

// social: friends, shares, splits (contract lives in @lr/schema)
export {
  profile,
  friendsResponse,
  inviteCreated,
  inviteAcceptResult,
  shareList,
  shareDetail,
  splitDetail,
  splitList,
  balances,
  REACTIONS,
  HANDLE_RE,
  MAX_SPLIT_PARTICIPANTS,
} from '@lr/schema';
export type { Profile, PublicUser, FriendsResponse, ShareItem, ShareDetail, SplitDetail, Balances, ProfileBody } from '@lr/schema';
import type { splitListItem } from '@lr/schema';
export type SplitListItem = z.infer<typeof splitListItem>;
