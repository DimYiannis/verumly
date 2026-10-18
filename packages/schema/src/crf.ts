import { z } from 'zod';

/** Canonical Receipt Format v1 (NL). Strict everywhere: no free-text, no buyer field. */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const uuidString = z.string().regex(UUID_RE, 'invalid uuid');
export const uuidV7String = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'invalid uuidv7');

export const RECEIPT_STATES = ['open', 'presented', 'paid', 'fiscalised', 'void'] as const;
export const receiptState = z.enum(RECEIPT_STATES);
export type ReceiptState = z.infer<typeof receiptState>;

/** The Dutch rates. Other countries have their own (`@lr/compliance` formats): the schema takes any rate, `validateCrf` checks it against the country. */
export const VAT_RATES = [21, 9, 0] as const;
export const KVK_RE = /^\d{8}$/;
export const BTW_ID_RE = /^NL\d{9}B\d{2}$/;
export const MAX_DESCRIPTION = 80;

const cents = z.number().int().min(-100_000_000).max(100_000_000);

/** A VAT rate in percent with at most two decimals (5.5, 8.1, 25.5). Which rates exist is a per-country question. */
export const vatRateNumber = z.number().min(0).max(40).refine((v) => Math.round(v * 100) / 100 === v, 'at most two decimals');
/** ISO 4217 code. Which one is right is a per-country question. */
export const currencyCode = z.string().regex(/^[A-Z]{3}$/);

export const crfLine = z
  .object({
    lineNo: z.number().int().min(1),
    kind: z.enum(['item', 'discount', 'deposit']),
    sku: z.string().max(40).nullable(),
    description: z.string().min(1).max(MAX_DESCRIPTION),
    /** decimal string, at most 3 decimals; negative for returns */
    qty: z.string().regex(/^-?\d{1,7}(\.\d{1,3})?$/),
    unitPrice: cents,
    vatRate: vatRateNumber.nullable(),
    discount: cents,
    total: cents,
    category: z.string().max(40).nullable(),
  })
  .strict();
export type CrfLine = z.infer<typeof crfLine>;

export const crfVatRow = z
  .object({
    rate: vatRateNumber,
    gross: cents,
    net: cents,
    vat: cents,
  })
  .strict();
export type CrfVatRow = z.infer<typeof crfVatRow>;

export const crfMerchant = z
  .object({
    /** company registry number of the organisation's country (KvK in NL, SIRET in FR, ...): the name is historical. Its format is checked per country by `validateCrf`. */
    kvkNumber: z.string().min(1).max(40),
    vatNumber: z.string().min(4).max(20).nullable(),
    name: z.string().min(1).max(120),
    locationId: uuidString,
    terminalId: uuidString,
  })
  .strict();

export const crfTotals = z
  .object({
    gross: cents,
    net: cents,
    vat: cents,
    tip: cents.min(0),
    /** cash rounding in minor units; the allowed range depends on the country's rounding step (`validateCrf`) */
    rounding: z.number().int().min(-250).max(250),
  })
  .strict();

export const crfPayment = z
  .object({ method: z.enum(['card', 'cash', 'other']), amount: cents })
  .strict();

export const crfFiscal = z
  .object({
    country: z.string().length(2),
    registerSerial: z.string().max(60).nullable(),
    documentNumber: z.string().max(60).nullable(),
    /** what the country's fiscal system added (TSE signature, document number, QR payload, ...); the keys come from `@lr/fiscal` */
    extra: z.record(z.string(), z.string().max(200)).refine((o) => Object.keys(o).length <= 12),
  })
  .strict();

export const crf = z
  .object({
    crf: z.literal('1'),
    receiptId: uuidV7String,
    version: z.number().int().min(1),
    state: receiptState,
    merchant: crfMerchant,
    createdAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
    currency: currencyCode,
    lines: z.array(crfLine).max(500),
    vatSummary: z.array(crfVatRow).max(8),
    totals: crfTotals,
    payments: z.array(crfPayment).max(10),
    fiscal: crfFiscal,
    voidOf: uuidString.nullable(),
  })
  .strict();
export type Crf = z.infer<typeof crf>;

/** Fields of CRF that may never appear (buyer identifiers, free text). Used by SDK stripping + tests. */
export const FORBIDDEN_CRF_KEYS = ['notes', 'note', 'customer', 'customerName', 'loyaltyCard', 'pan', 'email', 'phone'] as const;
