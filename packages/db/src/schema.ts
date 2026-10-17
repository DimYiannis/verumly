import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const merchant = pgSchema('merchant');
export const buyer = pgSchema('buyer');
export const leads = pgSchema('leads');
export const ops = pgSchema('ops');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ---------------------------------------------------------------- merchant

export const organizations = merchant.table('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  legalName: text('legal_name').notNull(),
  kvkNumber: text('kvk_number').notNull().unique(),
  vatNumber: text('vat_number').unique(),
  country: text('country').notNull().default('NL'),
  plan: text('plan').notNull().default('free'),
  retentionYears: integer('retention_years').notNull().default(7),
  /** country-specific legal settings (see @lr/compliance): { values: {...}, confirmedAt } */
  compliance: jsonb('compliance').notNull().default({}),
  /** receipt layout drawn in the dashboard designer (see receiptTemplate in @lr/schema); null = default */
  receiptTemplate: jsonb('receipt_template'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const locations = merchant.table('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  address: text('address'),
  postcode: text('postcode'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  timezone: text('timezone').notNull().default('Europe/Amsterdam'),
});

export const terminals = merchant.table('terminals', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id').notNull().references(() => locations.id),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  label: text('label').notNull(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  signingPublicKey: text('signing_public_key').notNull(),
  lastSeenAt: ts('last_seen_at'),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const receipts = merchant.table(
  'receipts',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    locationId: uuid('location_id').notNull().references(() => locations.id),
    terminalId: uuid('terminal_id').notNull().references(() => terminals.id),
    state: text('state').notNull(),
    currentVersion: integer('current_version').notNull(),
    claimSecretHash: text('claim_secret_hash').notNull(),
    totalMinor: integer('total_minor').notNull(),
    currency: text('currency').notNull().default('EUR'),
    createdOnTerminalAt: ts('created_on_terminal_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    claimableUntil: ts('claimable_until').notNull(),
  },
  (t) => [index('receipts_org_created_idx').on(t.orgId, t.createdOnTerminalAt)],
);

export const receiptVersions = merchant.table(
  'receipt_versions',
  {
    receiptId: uuid('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    version: integer('version').notNull(),
    state: text('state').notNull(),
    payload: jsonb('payload').notNull(),
    signature: text('signature').notNull(),
    createdOnTerminalAt: ts('created_on_terminal_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.receiptId, t.version] })],
);

export const receiptLines = merchant.table(
  'receipt_lines',
  {
    receiptId: uuid('receipt_id').notNull().references(() => receipts.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    lineNo: integer('line_no').notNull(),
    kind: text('kind').notNull(),
    sku: text('sku'),
    description: text('description').notNull(),
    qty: text('qty').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    vatRate: smallint('vat_rate'),
    totalMinor: integer('total_minor').notNull(),
    /** from the terminal if it sent one, else filled by the worker's `categorise` job */
    category: text('category'),
    /** health-related (apotheek/drogist); never shown in insights or exports of categories */
    sensitive: boolean('sensitive').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.receiptId, t.lineNo] })],
);

export const merchantUsers = merchant.table('merchant_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecretEncrypted: text('totp_secret_encrypted'),
  role: text('role').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const dashboardSessions = merchant.table('dashboard_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => merchantUsers.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  /** false until TOTP has been verified */
  mfaDone: boolean('mfa_done').notNull().default(false),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const dailyRollups = merchant.table(
  'daily_rollups',
  {
    locationId: uuid('location_id').notNull().references(() => locations.id),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    day: date('day', { mode: 'string' }).notNull(),
    gross: bigint('gross', { mode: 'number' }).notNull().default(0),
    gross21: bigint('gross_21', { mode: 'number' }).notNull().default(0),
    vat21: bigint('vat_21', { mode: 'number' }).notNull().default(0),
    gross9: bigint('gross_9', { mode: 'number' }).notNull().default(0),
    vat9: bigint('vat_9', { mode: 'number' }).notNull().default(0),
    gross0: bigint('gross_0', { mode: 'number' }).notNull().default(0),
    receiptCount: integer('receipt_count').notNull().default(0),
    voidCount: integer('void_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.locationId, t.day] })],
);

export const exportsTable = merchant.table('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  kind: text('kind').notNull(),
  periodFrom: date('period_from', { mode: 'string' }).notNull(),
  periodTo: date('period_to', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('queued'),
  s3Key: text('s3_key'),
  /** presigned GET url, valid until `expiresAt` (24 h) */
  url: text('url'),
  expiresAt: ts('expires_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------- buyer

export const users = buyer.table('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  locale: text('locale').notNull().default('nl'),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
});

export const sessions = buyer.table('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const emailCodes = buyer.table(
  'email_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('email_codes_email_idx').on(t.email)],
);

export const pushSubscriptions = buyer.table('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
});

export const claims = buyer.table(
  'claims',
  {
    receiptId: uuid('receipt_id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    claimedAt: ts('claimed_at').notNull().defaultNow(),
  },
  (t) => [index('claims_user_idx').on(t.userId, t.claimedAt)],
);

export const uploads = buyer.table('uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  contentType: text('content_type').notNull(),
  sha256: text('sha256'),
  status: text('status').notNull().default('pending_upload'),
  extracted: jsonb('extracted'),
  confidence: doublePrecision('confidence'),
  merchantKey: text('merchant_key'),
  matchedReceiptId: uuid('matched_receipt_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const consents = buyer.table(
  'consents',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    granted: boolean('granted').notNull(),
    policyVersion: text('policy_version').notNull(),
    changedAt: ts('changed_at').notNull().defaultNow(),
  },
  (t) => [index('consents_user_idx').on(t.userId, t.purpose, t.changedAt)],
);

// ---------------------------------------------------------------- leads

export const unknownMerchants = leads.table('unknown_merchants', {
  merchantKey: text('merchant_key').primaryKey(),
  name: text('name'),
  postcode: text('postcode'),
  distinctUploaders: integer('distinct_uploaders').notNull().default(0),
  firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  status: text('status').notNull().default('collecting'),
});

export const unknownMerchantUploaders = leads.table(
  'unknown_merchant_uploaders',
  {
    merchantKey: text('merchant_key').notNull().references(() => unknownMerchants.merchantKey, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.merchantKey, t.userId] })],
);

// ---------------------------------------------------------------- ops

export const auditLog = ops.table('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: ts('at').notNull().defaultNow(),
  event: text('event').notNull(),
  orgId: uuid('org_id'),
  terminalId: uuid('terminal_id'),
  receiptId: uuid('receipt_id'),
  /** never secrets, emails or receipt content */
  detail: jsonb('detail').notNull().default(sql`'{}'::jsonb`),
  requestId: text('request_id'),
});

export const idempotencyKeys = ops.table(
  'idempotency_keys',
  {
    terminalId: uuid('terminal_id').notNull(),
    key: text('key').notNull(),
    contentHash: text('content_hash').notNull(),
    receiptId: uuid('receipt_id').notNull(),
    version: integer('version').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.terminalId, t.key] }), uniqueIndex('idem_receipt_version').on(t.receiptId, t.version, t.key)],
);

/** One row per wrong secret presented for an existing receipt; drives "10 failed secrets per receipt per hour". */
export const resolveFailures = ops.table(
  'resolve_failures',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    receiptId: uuid('receipt_id').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('resolve_failures_receipt_idx').on(t.receiptId, t.at)],
);
