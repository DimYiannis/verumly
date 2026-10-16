import { z } from 'zod';
import { crf, uuidV7String } from './crf.ts';

/** Merchant API DTOs */
export const signedVersion = z
  .object({
    version: crf,
    signature: z.string().min(80).max(100),
  })
  .strict();
export type SignedVersion = z.infer<typeof signedVersion>;

export const createReceiptBody = signedVersion.extend({ claimSecretHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type CreateReceiptBody = z.infer<typeof createReceiptBody>;

export const addVersionBody = signedVersion;

export const batchItem = z.union([createReceiptBody, addVersionBody]);
export const batchBody = z
  .object({
    items: z
      .array(z.object({ idempotencyKey: z.string().min(8).max(200), body: batchItem }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export type BatchBody = z.infer<typeof batchBody>;

export const writeResult = z.object({
  receiptId: uuidV7String,
  version: z.number().int(),
  status: z.enum(['created', 'replayed']),
});

/** Public resolver DTOs */
export const secretString = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const resolveBody = z.object({ receiptId: uuidV7String, secret: secretString }).strict();
export type ResolveBody = z.infer<typeof resolveBody>;

export const receiptPreview = z.object({
  merchantName: z.string(),
  locationName: z.string(),
  total: z.number().int(),
  currency: z.literal('EUR'),
  createdAt: z.string(),
  state: z.string(),
  claimed: z.boolean(),
});
export type ReceiptPreview = z.infer<typeof receiptPreview>;

/** Buyer API DTOs */
export const emailStartBody = z.object({ email: z.string().email().max(200) }).strict();
export const emailVerifyBody = z.object({ email: z.string().email().max(200), code: z.string().regex(/^\d{6}$/) }).strict();
export const claimBody = resolveBody.extend({ source: z.enum(['qr', 'link']).default('qr') });
