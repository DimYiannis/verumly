import { and, asc, count, eq, gt } from 'drizzle-orm';
import { verifySecret } from '@lr/crypto';
import { tables, type Db } from '@lr/db';
import { isFinalState } from '@lr/receipt-nl';
import { crf as crfSchema, receiptTemplate, type Crf, type ReceiptPreview, type ReceiptTemplate } from '@lr/schema';

export const MAX_FAILED_SECRETS_PER_HOUR = 10;

export interface ReceiptRow {
  id: string;
  state: string;
  currentVersion: number;
  claimSecretHash: string;
  totalMinor: number;
  currency: string;
  createdOnTerminalAt: Date;
  claimableUntil: Date;
  locationName: string;
  crf: Crf;
  /** the merchant's receipt layout, null = the wallet default */
  template: ReceiptTemplate | null;
}

/** Load a receipt (never `open`) with its latest CRF and location name. */
export async function loadReceipt(db: Db, receiptId: string): Promise<ReceiptRow | undefined> {
  const [row] = await db
    .select({
      id: tables.receipts.id,
      state: tables.receipts.state,
      currentVersion: tables.receipts.currentVersion,
      claimSecretHash: tables.receipts.claimSecretHash,
      totalMinor: tables.receipts.totalMinor,
      currency: tables.receipts.currency,
      createdOnTerminalAt: tables.receipts.createdOnTerminalAt,
      claimableUntil: tables.receipts.claimableUntil,
      locationName: tables.locations.name,
      payload: tables.receiptVersions.payload,
      template: tables.organizations.receiptTemplate,
    })
    .from(tables.receipts)
    .innerJoin(tables.organizations, eq(tables.organizations.id, tables.receipts.orgId))
    .innerJoin(tables.locations, eq(tables.locations.id, tables.receipts.locationId))
    .innerJoin(
      tables.receiptVersions,
      and(eq(tables.receiptVersions.receiptId, tables.receipts.id), eq(tables.receiptVersions.version, tables.receipts.currentVersion)),
    )
    .where(eq(tables.receipts.id, receiptId));
  if (!row) return undefined;
  const { payload, template, ...rest } = row;
  const tpl = receiptTemplate.safeParse(template);
  return { ...rest, crf: crfSchema.parse(payload), template: tpl.success ? tpl.data : null };
}

export type SecretCheck =
  | { kind: 'pending' }
  | { kind: 'limited' }
  | { kind: 'bad' }
  | { kind: 'ok'; receipt: ReceiptRow };

/**
 * Resolve (receiptId, secret). An unknown or `open` receipt is indistinguishable from "not uploaded yet",
 * so both are `pending`. A wrong secret on an existing receipt is 404 and counts toward the hourly limit.
 */
export async function checkSecret(db: Db, receiptId: string, secret: string): Promise<SecretCheck> {
  const [failures] = await db
    .select({ n: count() })
    .from(tables.resolveFailures)
    .where(and(eq(tables.resolveFailures.receiptId, receiptId), gt(tables.resolveFailures.at, new Date(Date.now() - 3_600_000))));
  if ((failures?.n ?? 0) >= MAX_FAILED_SECRETS_PER_HOUR) return { kind: 'limited' };

  const receipt = await loadReceipt(db, receiptId);
  if (!receipt || receipt.state === 'open') return { kind: 'pending' };
  if (!verifySecret(secret, receipt.claimSecretHash)) {
    await db.insert(tables.resolveFailures).values({ receiptId });
    return { kind: 'bad' };
  }
  return { kind: 'ok', receipt };
}

export async function claimedBy(db: Db, receiptId: string): Promise<string | undefined> {
  const [c] = await db.select({ userId: tables.claims.userId }).from(tables.claims).where(eq(tables.claims.receiptId, receiptId));
  return c?.userId;
}

export function toPreview(r: ReceiptRow, claimed: boolean): ReceiptPreview {
  return {
    merchantName: r.crf.merchant.name,
    locationName: r.locationName,
    total: r.totalMinor,
    currency: r.currency,
    createdAt: r.createdOnTerminalAt.toISOString(),
    state: r.state,
    claimed,
  };
}

export async function loadVersions(db: Db, receiptId: string) {
  const rows = await db
    .select({
      version: tables.receiptVersions.version,
      state: tables.receiptVersions.state,
      payload: tables.receiptVersions.payload,
      createdOnTerminalAt: tables.receiptVersions.createdOnTerminalAt,
    })
    .from(tables.receiptVersions)
    .where(eq(tables.receiptVersions.receiptId, receiptId))
    .orderBy(asc(tables.receiptVersions.version));
  return rows.map((v) => ({ version: v.version, state: v.state, createdAt: v.createdOnTerminalAt.toISOString(), crf: crfSchema.parse(v.payload) }));
}

export function isFinal(r: Pick<ReceiptRow, 'state' | 'crf'>): boolean {
  return isFinalState(r.state as Crf['state'], r.crf.fiscal.country);
}
