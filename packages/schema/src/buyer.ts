import { z } from 'zod';
import { uuidString } from './crf.ts';

/** Buyer API DTOs beyond auth/claims: uploads, consents, push subscriptions. */

/** PDF and HEIC are not extracted (Qianfan reads raster images): refused at the API, and before upload in the wallet. */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_UPLOAD_BYTES = 10_000_000;

export const createUploadBody = z
  .object({
    contentType: z.enum(UPLOAD_CONTENT_TYPES),
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  })
  .strict();
export type CreateUploadBody = z.infer<typeof createUploadBody>;

/** The categories a receipt line can have (the buyer picks from these); `@lr/receipt-nl` rules produce exactly these. */
export const LINE_CATEGORIES = ['gezondheid', 'statiegeld', 'dining', 'boodschappen', 'huishouden', 'vervoer', 'kleding', 'elektronica', 'overig'] as const;
export type LineCategory = (typeof LINE_CATEGORIES)[number];

const cents = z.number().int().min(-100_000_000).max(100_000_000);

export const parsedLine = z
  .object({
    description: z.string().min(1).max(80),
    qty: z.string().regex(/^-?\d{1,7}(\.\d{1,3})?$/),
    unitPrice: cents.nullable(),
    total: cents,
    vatRate: z.union([z.literal(21), z.literal(9), z.literal(0)]).nullable(),
    kind: z.enum(['item', 'discount', 'deposit']),
    /** stored by the worker and after every correction (`categoriseLines`); derived data, never trusted from a client */
    category: z.string().min(1).max(40).optional(),
    sensitive: z.boolean().optional(),
    /** the buyer's own category: kept by every later re-categorisation, and never sensitive */
    userCategory: z.enum(LINE_CATEGORIES).nullable().optional(),
  })
  .strict();
export type ParsedLineDto = z.infer<typeof parsedLine>;

export const parsedReceipt = z.object({
  status: z.enum(['done', 'needs_review']),
  failures: z.array(z.string()),
  merchant: z.object({
    name: z.string().nullable(),
    kvkNumber: z.string().nullable(),
    vatNumber: z.string().nullable(),
    postcode: z.string().nullable(),
  }),
  merchantKey: z.string().nullable(),
  printedAtUtc: z.string().nullable(),
  lines: z.array(parsedLine),
  gross: cents.nullable(),
  rounding: z.number().int(),
  vatBreakdown: z.array(z.object({ rate: z.number(), base: cents.nullable(), vat: cents })),
  paymentMethod: z.enum(['card', 'cash', 'other']).nullable(),
});
export type ParsedReceiptDto = z.infer<typeof parsedReceipt>;

/** What the worker stores in `buyer.uploads.extracted`. */
export const uploadExtracted = z.object({
  parsed: parsedReceipt.nullable(),
  failures: z.array(z.string()),
  modelRevision: z.string().nullable(),
  /** true once the buyer corrected a `needs_review` draft */
  corrected: z.boolean().default(false),
});
export type UploadExtracted = z.infer<typeof uploadExtracted>;

export const UPLOAD_STATUSES = ['pending_upload', 'processing', 'done', 'needs_review', 'failed', 'replaced'] as const;

export const uploadPatchBody = z
  .object({
    merchantName: z.string().min(1).max(120).optional(),
    printedAt: z.iso.datetime().optional(),
    gross: cents.optional(),
    lines: z.array(parsedLine).min(1).max(200).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'empty patch');
export type UploadPatchBody = z.infer<typeof uploadPatchBody>;

/** `category: null` removes the buyer's choice again, so the rules decide. */
export const uploadCategoriesBody = z
  .object({ lines: z.array(z.object({ index: z.number().int().min(0).max(199), category: z.enum(LINE_CATEGORIES).nullable() }).strict()).min(1).max(200) })
  .strict();
export type UploadCategoriesBody = z.infer<typeof uploadCategoriesBody>;

export const CONSENT_PURPOSES = ['analytics', 'marketing', 'push'] as const;
export const consentsBody = z
  .object({ analytics: z.boolean().optional(), marketing: z.boolean().optional(), push: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'at least one purpose');
export type ConsentsBody = z.infer<typeof consentsBody>;

export const pushSubscriptionBody = z
  .object({
    endpoint: z.url().max(2048),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(10).max(100) }).strict(),
  })
  .strict();
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionBody>;

export const idParam = z.object({ id: uuidString });
