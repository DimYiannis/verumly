import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateSecret, newReceiptId, signBytes } from '@lr/crypto';
import { buildCrf, createWorld, merchantPost, signedBody, sql, submit, type World } from '../../../scripts/lib/testkit.ts';

let w: World;

beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

const versions = (receiptId: string) =>
  sql<{ version: number }>(w, 'select version from merchant.receipt_versions where receipt_id = $1 order by received_at, version', [receiptId]).then((r) => r.map((x) => x.version));

describe('version gap', () => {
  it('v3 before v2 → 409 version_gap with the expected number; nothing is stored', async () => {
    const receiptId = newReceiptId();
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret: generateSecret() });
    const res = await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 3, state: 'paid', org: w.orgA }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'version_gap', detail: { expected: 2 } });
    expect(await versions(receiptId)).toEqual([1]);
  });

  it('a version for an unknown receipt → 409 version_gap (expected 1)', async () => {
    const res = await submit(w.merchant, w.orgA, buildCrf({ receiptId: newReceiptId(), version: 2, state: 'paid', org: w.orgA }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'version_gap', detail: { expected: 1 } });
  });

  it('version 0 is rejected by the schema (400)', async () => {
    const receiptId = newReceiptId();
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret: generateSecret() });
    const zero = await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 0, state: 'paid', org: w.orgA }));
    expect(zero.status).toBe(400);
  });

  it('a gap, then batch upload fills in order: [v2, v3, v4] in one request', async () => {
    const receiptId = newReceiptId();
    const secret = generateSecret();
    expect((await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret })).status).toBe(201);
    const v3 = buildCrf({ receiptId, version: 3, state: 'presented', org: w.orgA, lines: [{ unitPrice: 300, vatRate: 9 }] });
    const gap = await submit(w.merchant, w.orgA, v3);
    expect(gap.status).toBe(409);
    expect(gap.body).toMatchObject({ error: 'version_gap' });

    const chain = [
      buildCrf({ receiptId, version: 2, state: 'presented', org: w.orgA, lines: [{ unitPrice: 200, vatRate: 9 }] }),
      v3,
      buildCrf({ receiptId, version: 4, state: 'paid', org: w.orgA, lines: [{ unitPrice: 300, vatRate: 9 }] }),
    ];
    const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts:batch', {
      items: chain.map((c) => ({ idempotencyKey: `${c.receiptId}:${c.version}`, body: signedBody(w.orgA, c) })),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      results: [
        { status: 'created', version: 2 },
        { status: 'created', version: 3 },
        { status: 'created', version: 4 },
      ],
    });
    expect(await versions(receiptId)).toEqual([1, 2, 3, 4]);
    const [r] = await sql<{ state: string; current_version: number }>(w, 'select state, current_version from merchant.receipts where id = $1', [receiptId]);
    expect(r).toEqual({ state: 'paid', current_version: 4 });
  });

  it('out-of-order batch: the gapped item fails with 409 version_gap, the in-order one lands, a second pass completes the chain', async () => {
    const receiptId = newReceiptId();
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret: generateSecret() });
    const v2 = buildCrf({ receiptId, version: 2, state: 'presented', org: w.orgA, lines: [{ unitPrice: 200, vatRate: 9 }] });
    const v3 = buildCrf({ receiptId, version: 3, state: 'paid', org: w.orgA, lines: [{ unitPrice: 200, vatRate: 9 }] });
    const batch = (cs: typeof v2[]) =>
      merchantPost(w.merchant, w.orgA, '/v1/receipts:batch', { items: cs.map((c) => ({ idempotencyKey: `${c.receiptId}:${c.version}`, body: signedBody(w.orgA, c) })) });
    const first = await batch([v3, v2]);
    expect(first.body).toMatchObject({ results: [{ status: 'error', httpStatus: 409, error: 'version_gap' }, { status: 'created', version: 2 }] });
    const second = await batch([v3]);
    expect(second.body).toMatchObject({ results: [{ status: 'created', version: 3 }] });
    expect(await versions(receiptId)).toEqual([1, 2, 3]);
  });
});

describe('batch', () => {
  it('returns a result per item, in request order, with the right status for each outcome', async () => {
    const dup = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const dupSecret = generateSecret();
    expect((await submit(w.merchant, w.orgA, dup, { secret: dupSecret })).status).toBe(201);

    const fresh = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const freshSecret = generateSecret();
    const bad = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    bad.totals.gross += 1; // arithmetic does not add up → 422
    const orphan = buildCrf({ receiptId: newReceiptId(), version: 5, state: 'paid', org: w.orgA });
    const clash = buildCrf({ receiptId: dup.receiptId, version: 1, state: 'presented', org: w.orgA, lines: [{ unitPrice: 777, vatRate: 21 }] });
    const forged = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });

    const items = [
      { idempotencyKey: 'batch-item-fresh', body: signedBody(w.orgA, fresh, freshSecret) },
      { idempotencyKey: 'batch-item-replay', body: signedBody(w.orgA, dup, dupSecret) },
      { idempotencyKey: 'batch-item-invalid', body: signedBody(w.orgA, bad, generateSecret()) },
      { idempotencyKey: 'batch-item-gap', body: signedBody(w.orgA, orphan) },
      { idempotencyKey: 'batch-item-clash', body: signedBody(w.orgA, clash, dupSecret) },
      // valid body, but the per-version signature was made with a different key
      { idempotencyKey: 'batch-item-forged', body: { ...signedBody(w.orgA, forged, generateSecret()), signature: signedBody(w.orgB, forged).signature } },
    ];
    const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts:batch', { items });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      results: [
        { idempotencyKey: 'batch-item-fresh', status: 'created', receiptId: fresh.receiptId, version: 1 },
        { idempotencyKey: 'batch-item-replay', status: 'replayed', receiptId: dup.receiptId, version: 1 },
        { idempotencyKey: 'batch-item-invalid', status: 'error', httpStatus: 422, error: 'invalid_receipt' },
        { idempotencyKey: 'batch-item-gap', status: 'error', httpStatus: 409, error: 'version_gap' },
        { idempotencyKey: 'batch-item-clash', status: 'error', httpStatus: 409, error: 'idempotency_conflict' },
        { idempotencyKey: 'batch-item-forged', status: 'error', httpStatus: 401, error: 'bad_signature' },
      ],
    });
    // one failing item does not abort the others
    expect(await versions(fresh.receiptId)).toEqual([1]);
    expect(await versions(bad.receiptId)).toEqual([]);
  });

  it('accepts exactly 500 items and rejects 501 (and 0) with 400 before processing anything', async () => {
    const make = () => {
      const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
      return { crf, item: { idempotencyKey: `${crf.receiptId}:1`, body: signedBody(w.orgA, crf, generateSecret()) } };
    };
    const many = Array.from({ length: 501 }, make);

    const tooMany = await merchantPost(w.merchant, w.orgA, '/v1/receipts:batch', { items: many.map((m) => m.item) });
    expect(tooMany.status).toBe(400);
    expect(await sql(w, 'select 1 from merchant.receipts where id = $1', [many[0]!.crf.receiptId])).toHaveLength(0);

    const empty = await merchantPost(w.merchant, w.orgA, '/v1/receipts:batch', { items: [] });
    expect(empty.status).toBe(400);

    const exactly = await merchantPost(w.merchant, w.orgA, '/v1/receipts:batch', { items: many.slice(0, 500).map((m) => m.item) });
    expect(exactly.status).toBe(200);
    const { results } = z.object({ results: z.array(z.object({ status: z.string() })) }).parse(exactly.body);
    expect(results).toHaveLength(500);
    expect(results.every((r) => r.status === 'created')).toBe(true);
    expect(await sql(w, "select 1 from merchant.receipts where id = any($1::uuid[])", [many.slice(0, 500).map((m) => m.crf.receiptId)])).toHaveLength(500);
  }, 120_000);

  it('X-Signature covers the whole batch body: a tampered batch is rejected before any item is processed', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const body = { items: [{ idempotencyKey: 'tamper-key-1', body: signedBody(w.orgA, crf, generateSecret()) }] };
    const signedText = JSON.stringify(body);
    const tampered = signedText.replace('tamper-key-1', 'tamper-key-2');
    const res = await w.merchant.inject({
      method: 'POST',
      url: '/v1/receipts:batch',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${w.orgA.terminal.apiKey}`,
        'x-terminal-id': w.orgA.terminal.terminalId,
        'x-signature': signBytes(w.orgA.terminal.keys.privateKey, new TextEncoder().encode(signedText)),
      },
      payload: tampered,
    });
    expect(res.statusCode).toBe(401);
    expect(await sql(w, 'select 1 from merchant.receipts where id = $1', [crf.receiptId])).toHaveLength(0);
  });
});
