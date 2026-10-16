import { and, eq, sql } from 'drizzle-orm';
import { jcsString, sha256Hex, verifyPayload } from '@lr/crypto';
import { tables, withOrg, type Db, type Tx } from '@lr/db';
import { checkTransition, validateCrf, type Issue } from '@lr/receipt-nl';
import type { Crf, SignedVersion } from '@lr/schema';

export interface TerminalCtx {
  terminalId: string;
  orgId: string;
  locationId: string;
  publicKey: string;
  country: string;
}

export interface IngestInput {
  idempotencyKey: string;
  body: SignedVersion & { claimSecretHash?: string };
  /** true for POST /v1/receipts (must be version 1 and carry claimSecretHash) */
  create: boolean;
  /** receiptId from the path for POST /v1/receipts/:id/versions */
  pathReceiptId?: string;
  claimWindowDays: number;
  requestId: string;
}

export type IngestOutcome =
  | { ok: true; status: 'created' | 'replayed'; receiptId: string; version: number; state: Crf['state']; notify: boolean }
  | { ok: false; httpStatus: number; error: string; issues?: Issue[]; detail?: Record<string, unknown> };

const fail = (httpStatus: number, error: string, extra: Partial<Extract<IngestOutcome, { ok: false }>> = {}): IngestOutcome => ({
  ok: false,
  httpStatus,
  error,
  ...extra,
});

class Conflict extends Error {
  readonly outcome: IngestOutcome;
  readonly audit?: { event: string; detail: Record<string, unknown> };
  constructor(outcome: IngestOutcome, audit?: { event: string; detail: Record<string, unknown> }) {
    super('ingest conflict');
    this.outcome = outcome;
    this.audit = audit;
  }
}

async function audit(db: Db, ctx: TerminalCtx, event: string, receiptId: string | null, detail: Record<string, unknown>, requestId: string) {
  await db.insert(tables.auditLog).values({
    event,
    orgId: ctx.orgId,
    terminalId: ctx.terminalId,
    receiptId,
    detail,
    requestId,
  });
}

function pgCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') return e.code;
  return undefined;
}

function isUniqueViolation(e: unknown): boolean {
  const cause = typeof e === 'object' && e !== null && 'cause' in e ? e.cause : undefined;
  return pgCode(e) === '23505' || pgCode(cause) === '23505';
}

/**
 * Validate, verify and store one signed receipt version. Idempotent on (terminal, key) and on (receiptId, version).
 * Never logs or audits receipt content.
 */
export async function ingestVersion(db: Db, ctx: TerminalCtx, input: IngestInput): Promise<IngestOutcome> {
  const { body } = input;
  const crf = body.version;

  if (input.create && (crf.version !== 1 || !body.claimSecretHash)) return fail(422, 'invalid_receipt', { detail: { reason: 'create_requires_v1_and_secret_hash' } });
  if (input.pathReceiptId && input.pathReceiptId !== crf.receiptId) return fail(422, 'invalid_receipt', { detail: { reason: 'receipt_id_mismatch' } });

  const issues = validateCrf(crf, { country: ctx.country });
  if (issues.length) return fail(422, 'invalid_receipt', { issues });

  if (!verifyPayload(ctx.publicKey, crf, body.signature)) {
    await audit(db, ctx, 'failed_signature', crf.receiptId, { version: crf.version }, input.requestId);
    return fail(401, 'bad_signature');
  }

  const contentHash = sha256Hex(jcsString({ version: crf, signature: body.signature, claimSecretHash: body.claimSecretHash ?? null }));

  for (let attempt = 0; ; attempt++) {
    try {
      const out = await withOrg(db, ctx.orgId, (tx) => store(tx, ctx, input, contentHash));
      return out;
    } catch (e) {
      if (e instanceof Conflict) {
        if (e.audit) await audit(db, ctx, e.audit.event, crf.receiptId, e.audit.detail, input.requestId);
        return e.outcome;
      }
      // concurrent insert of the same (receiptId, version) or key: re-run, it will now see the winner
      if (isUniqueViolation(e)) {
        if (attempt < 2) continue;
        // Still colliding after re-reading: the receipt id belongs to a receipt this organisation cannot see
        // (row-level security hides it), i.e. another organisation's. Never a 500, never an overwrite.
        await audit(db, ctx, 'idempotency_conflict', crf.receiptId, { version: crf.version, reason: 'receipt_id_taken' }, input.requestId);
        return fail(409, 'idempotency_conflict');
      }
      throw e;
    }
  }
}

async function store(tx: Tx, ctx: TerminalCtx, input: IngestInput, contentHash: string): Promise<IngestOutcome> {
  const { body } = input;
  const crf = body.version;
  const ok = (status: 'created' | 'replayed', notify: boolean): IngestOutcome => ({
    ok: true,
    status,
    receiptId: crf.receiptId,
    version: crf.version,
    state: crf.state,
    notify,
  });
  const idemConflict = () =>
    new Conflict(fail(409, 'idempotency_conflict'), { event: 'idempotency_conflict', detail: { version: crf.version } });

  // Lock the receipt row first so a concurrent writer of the same receipt finishes before the replay checks below
  // run; otherwise a retried request racing its twin sees "version already exists" too late and gets a version_gap.
  const [current] = await tx
    .select({
      currentVersion: tables.receipts.currentVersion,
      state: tables.receipts.state,
      terminalId: tables.receipts.terminalId,
    })
    .from(tables.receipts)
    .where(eq(tables.receipts.id, crf.receiptId))
    .for('update');

  // 1. same Idempotency-Key from this terminal
  const [byKey] = await tx
    .select()
    .from(tables.idempotencyKeys)
    .where(and(eq(tables.idempotencyKeys.terminalId, ctx.terminalId), eq(tables.idempotencyKeys.key, input.idempotencyKey)));
  if (byKey) {
    if (byKey.contentHash === contentHash) return ok('replayed', false);
    throw idemConflict();
  }

  // 2. same (receiptId, version) already stored
  const [existingVersion] = await tx
    .select({ payload: tables.receiptVersions.payload, signature: tables.receiptVersions.signature })
    .from(tables.receiptVersions)
    .where(and(eq(tables.receiptVersions.receiptId, crf.receiptId), eq(tables.receiptVersions.version, crf.version)));
  if (existingVersion) {
    const same = jcsString(existingVersion.payload) === jcsString(crf) && existingVersion.signature === body.signature;
    if (!same) throw idemConflict();
    await tx
      .insert(tables.idempotencyKeys)
      .values({ terminalId: ctx.terminalId, key: input.idempotencyKey, contentHash, receiptId: crf.receiptId, version: crf.version })
      .onConflictDoNothing();
    return ok('replayed', false);
  }

  // 3. new version: lifecycle + gap checks (`current` was read above)
  if (input.create) {
    if (current) throw new Conflict(fail(409, 'version_gap', { detail: { expected: current.currentVersion + 1 } }));
    const t = checkTransition(null, crf.state, ctx.country);
    if (!t.ok) throw new Conflict(fail(409, t.reason));
    const received = new Date();
    await tx.insert(tables.receipts).values({
      id: crf.receiptId,
      orgId: ctx.orgId,
      locationId: ctx.locationId,
      terminalId: ctx.terminalId,
      state: crf.state,
      currentVersion: 1,
      claimSecretHash: body.claimSecretHash!,
      totalMinor: crf.totals.gross,
      currency: crf.currency,
      createdOnTerminalAt: new Date(crf.createdAt),
      receivedAt: received,
      claimableUntil: new Date(received.getTime() + input.claimWindowDays * 86_400_000),
    });
  } else {
    if (!current) throw new Conflict(fail(409, 'version_gap', { detail: { expected: 1, reason: 'unknown_receipt' } }));
    if (current.terminalId !== ctx.terminalId) throw new Conflict(fail(404, 'not_found'));
    if (crf.version !== current.currentVersion + 1) {
      throw new Conflict(fail(409, 'version_gap', { detail: { expected: current.currentVersion + 1 } }));
    }
    const t = checkTransition(current.state as Crf['state'], crf.state, ctx.country);
    if (!t.ok) throw new Conflict(fail(409, t.reason));
    await tx
      .update(tables.receipts)
      .set({ state: crf.state, currentVersion: crf.version, totalMinor: crf.totals.gross })
      .where(eq(tables.receipts.id, crf.receiptId));
  }

  await tx.insert(tables.receiptVersions).values({
    receiptId: crf.receiptId,
    orgId: ctx.orgId,
    version: crf.version,
    state: crf.state,
    payload: crf,
    signature: body.signature,
    createdOnTerminalAt: new Date(crf.createdAt),
  });

  await tx.delete(tables.receiptLines).where(eq(tables.receiptLines.receiptId, crf.receiptId));
  if (crf.lines.length) {
    await tx.insert(tables.receiptLines).values(
      crf.lines.map((l) => ({
        receiptId: crf.receiptId,
        orgId: ctx.orgId,
        lineNo: l.lineNo,
        kind: l.kind,
        sku: l.sku,
        description: l.description,
        qty: l.qty,
        unitPriceMinor: l.unitPrice,
        vatRate: l.vatRate,
        totalMinor: l.total,
        category: l.category,
      })),
    );
  }

  await tx
    .insert(tables.idempotencyKeys)
    .values({ terminalId: ctx.terminalId, key: input.idempotencyKey, contentHash, receiptId: crf.receiptId, version: crf.version });
  await tx.execute(sql`update merchant.terminals set last_seen_at = now() where id = ${ctx.terminalId}`);

  // The merchant side cannot know whether anyone claimed the receipt. Every later version enqueues
  // notify-version and the worker checks claims on the buyer side.
  return ok('created', crf.version > 1);
}
