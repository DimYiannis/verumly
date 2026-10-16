import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, hashSecret, newReceiptId } from '@lr/crypto';
import { buildCrf, createWorld, merchantPost, signedBody, sql, submit, type World } from '../../../scripts/lib/testkit.ts';

let w: World;

beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

const versionRows = (receiptId: string) =>
  sql<{ version: number }>(w, 'select version from merchant.receipt_versions where receipt_id = $1 order by version', [receiptId]);
const auditRows = (event: string, receiptId: string) =>
  sql<{ detail: unknown; terminal_id: string; org_id: string }>(w, 'select detail, terminal_id, org_id from ops.audit_log where event = $1 and receipt_id = $2', [event, receiptId]);

describe('idempotent replay', () => {
  it('the same version posted twice: 201 created, then 200 replayed with the same result', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const secret = generateSecret();
    const first = await submit(w.merchant, w.orgA, crf, { secret });
    const second = await submit(w.merchant, w.orgA, crf, { secret });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ receiptId, version: 1, status: 'created' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ receiptId, version: 1, status: 'replayed' });
    expect(await versionRows(receiptId)).toHaveLength(1);
    expect(await auditRows('idempotency_conflict', receiptId)).toHaveLength(0);
  });

  it('a replayed v2 is stored once and enqueues exactly one notify-version job', async () => {
    const { receiptId, secret } = { receiptId: newReceiptId(), secret: generateSecret() };
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret });
    const before = w.jobs.length;
    const v2 = buildCrf({ receiptId, version: 2, state: 'paid', org: w.orgA });
    const results = [await submit(w.merchant, w.orgA, v2), await submit(w.merchant, w.orgA, v2), await submit(w.merchant, w.orgA, v2)];
    expect(results.map((r) => r.status)).toEqual([201, 200, 200]);
    expect(await versionRows(receiptId)).toEqual([{ version: 1 }, { version: 2 }]);
    expect(w.jobs.length).toBe(before + 1);
  });

  it('the same content under a new Idempotency-Key is a replay, not a duplicate', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const secret = generateSecret();
    expect((await submit(w.merchant, w.orgA, crf, { secret, idempotencyKey: 'key-one-aaaa' })).status).toBe(201);
    const again = await submit(w.merchant, w.orgA, crf, { secret, idempotencyKey: 'key-two-bbbb' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: 'replayed' });
    expect(await versionRows(receiptId)).toHaveLength(1);
  });

  it('replaying v1 with a different claimSecretHash does not replace the stored secret hash', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const secret = generateSecret();
    await submit(w.merchant, w.orgA, crf, { secret });
    const other = generateSecret();
    const res = await submit(w.merchant, w.orgA, crf, { secret: other, idempotencyKey: 'other-secret-key' });
    expect(res.status).toBe(200);
    const [row] = await sql<{ claim_secret_hash: string }>(w, 'select claim_secret_hash from merchant.receipts where id = $1', [receiptId]);
    expect(row?.claim_secret_hash).toBe(hashSecret(secret));
    expect(row?.claim_secret_hash).not.toBe(hashSecret(other));
  });

  it('Idempotency-Key is required (≥ 8 chars)', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const body = signedBody(w.orgA, crf, generateSecret());
    expect((await merchantPost(w.merchant, w.orgA, '/v1/receipts', body)).status).toBe(400);
    expect((await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: 'short' })).status).toBe(400);
  });

  it('keys are scoped per terminal: another organisation can use the same key', async () => {
    const a = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const b = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgB, lines: [{ unitPrice: 999, vatRate: 21 }] });
    const ra = await submit(w.merchant, w.orgA, a, { secret: generateSecret(), idempotencyKey: 'shared-key-123' });
    const rb = await submit(w.merchant, w.orgB, b, { secret: generateSecret(), idempotencyKey: 'shared-key-123' });
    expect([ra.status, rb.status]).toEqual([201, 201]);
  });
});

describe('409 idempotency_conflict', () => {
  it('same Idempotency-Key, different content → 409 and an audit entry; the second payload is not stored', async () => {
    const first = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const second = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA, lines: [{ unitPrice: 12345, vatRate: 21 }] });
    expect((await submit(w.merchant, w.orgA, first, { secret: generateSecret(), idempotencyKey: 'reused-key-1' })).status).toBe(201);
    const res = await submit(w.merchant, w.orgA, second, { secret: generateSecret(), idempotencyKey: 'reused-key-1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'idempotency_conflict' });
    expect(await versionRows(second.receiptId)).toHaveLength(0);
    const audit = await auditRows('idempotency_conflict', second.receiptId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.terminal_id).toBe(w.orgA.terminal.terminalId);
    expect(audit[0]?.org_id).toBe(w.orgA.orgId);
  });

  it('same (receiptId, version), different content, different key → 409 and an audit entry; the original is intact', async () => {
    const receiptId = newReceiptId();
    const original = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const forged = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA, lines: [{ unitPrice: 1, vatRate: 21 }] });
    const secret = generateSecret();
    expect((await submit(w.merchant, w.orgA, original, { secret })).status).toBe(201);
    const res = await submit(w.merchant, w.orgA, forged, { secret, idempotencyKey: 'different-key-1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'idempotency_conflict' });
    const [row] = await sql<{ payload: { totals: { gross: number } } }>(w, 'select payload from merchant.receipt_versions where receipt_id = $1', [receiptId]);
    expect(row?.payload.totals.gross).toBe(680);
    expect(await auditRows('idempotency_conflict', receiptId)).toHaveLength(1);
  });

  it('same (receiptId, version) as v2 with a different payload → 409 + audit', async () => {
    const receiptId = newReceiptId();
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret: generateSecret() });
    const v2 = buildCrf({ receiptId, version: 2, state: 'presented', org: w.orgA, lines: [{ unitPrice: 500, vatRate: 9 }] });
    const v2b = buildCrf({ receiptId, version: 2, state: 'paid', org: w.orgA });
    expect((await submit(w.merchant, w.orgA, v2)).status).toBe(201);
    const res = await submit(w.merchant, w.orgA, v2b, { idempotencyKey: 'another-v2-key' });
    expect(res.status).toBe(409);
    expect(await auditRows('idempotency_conflict', receiptId)).toHaveLength(1);
  });

  it('a key already used for v1 cannot be reused for v2 content', async () => {
    const receiptId = newReceiptId();
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret: generateSecret(), idempotencyKey: 'recycled-key-1' });
    const res = await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 2, state: 'paid', org: w.orgA }), { idempotencyKey: 'recycled-key-1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'idempotency_conflict' });
    expect(await versionRows(receiptId)).toEqual([{ version: 1 }]);
  });

  it('audit entries carry no receipt content and no secret', async () => {
    const rows = await sql<{ detail: Record<string, unknown> }>(w, "select detail from ops.audit_log where event = 'idempotency_conflict'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Object.keys(r.detail).every((k) => k === 'version' || k === 'reason')).toBe(true);
  });
});

describe('concurrency: exactly once', () => {
  it('12 concurrent identical creates → one 201, eleven 200 replayed, one stored version', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const secret = generateSecret();
    const results = await Promise.all(Array.from({ length: 12 }, () => submit(w.merchant, w.orgA, crf, { secret })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(11);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(await versionRows(receiptId)).toHaveLength(1);
    expect(await sql(w, 'select 1 from ops.idempotency_keys where receipt_id = $1', [receiptId])).toHaveLength(1);
  });

  it('12 concurrent identical creates under different keys → still exactly one stored version', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const secret = generateSecret();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => submit(w.merchant, w.orgA, crf, { secret, idempotencyKey: `parallel-key-${i}` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(11);
    expect(await versionRows(receiptId)).toHaveLength(1);
  });

  it('concurrent v2 of one receipt: the same content lands once; different content loses with 409', async () => {
    const receiptId = newReceiptId();
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret: generateSecret() });
    const mk = (cents: number) => buildCrf({ receiptId, version: 2, state: 'presented', org: w.orgA, lines: [{ unitPrice: cents, vatRate: 9 }] });
    const variants = [mk(100), mk(200), mk(300)];
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) => submit(w.merchant, w.orgA, variants[i % 3]!, { idempotencyKey: `race-v2-${i}` })),
    );
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);
    expect(results.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
    expect(await versionRows(receiptId)).toEqual([{ version: 1 }, { version: 2 }]);
    // the 409s are the other two contents (and only those); the winner's own content replays as 200
    const winnerCents = (await sql<{ payload: { lines: Array<{ unitPrice: number }> } }>(w, 'select payload from merchant.receipt_versions where receipt_id = $1 and version = 2', [receiptId]))[0]?.payload.lines[0]?.unitPrice;
    const winnerIdx = [100, 200, 300].indexOf(winnerCents ?? -1);
    results.forEach((r, i) => {
      if (i % 3 === winnerIdx) expect([200, 201]).toContain(r.status);
      else expect(r.status).toBe(409);
    });
  });

  it('concurrent creates of one (receiptId, version 1) with different contents: one wins, the rest 409', async () => {
    const receiptId = newReceiptId();
    const secret = generateSecret();
    const mk = (cents: number) => buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA, lines: [{ unitPrice: cents, vatRate: 9 }] });
    const results = await Promise.all([100, 200, 300, 400, 500, 600].map((c, i) => submit(w.merchant, w.orgA, mk(c), { secret, idempotencyKey: `race-v1-${i}` })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await versionRows(receiptId)).toHaveLength(1);
  });
});
