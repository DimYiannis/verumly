import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, hashSecret, newReceiptId } from '@lr/crypto';
import { buildCrf, createWorld, merchantPost, signedBody, sql, submit, type World } from '../../../scripts/lib/testkit.ts';

// The three "Known open issues" from the v2 Handoff notes are deliberately NOT fixed. These tests pin today's behaviour so the
// FINDINGS entry is evidence, not assertion. When v2 is updated and an issue is fixed, the matching test must be flipped.

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

describe('known open issues (not fixed on purpose)', () => {
  it('#1 claimSecretHash is not covered by the receipt signature: the same signed version is accepted with any hash', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    const chosen = generateSecret();
    const body = signedBody(w.orgA, crf, chosen); // per-version signature covers `crf` only
    const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts', { ...body, claimSecretHash: hashSecret(generateSecret()) }, { idempotencyKey: 'open-issue-1' });
    expect(res.status).toBe(201);
    const [row] = await sql<{ claim_secret_hash: string }>(w, 'select claim_secret_hash from merchant.receipts where id = $1', [receiptId]);
    expect(row?.claim_secret_hash).not.toBe(hashSecret(chosen));
  });

  it('#2 merchant.terminalId / locationId in the payload are not compared with the authenticated terminal; the columns come from the authentication', async () => {
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA });
    crf.merchant = { ...crf.merchant, terminalId: w.orgB.terminal.terminalId, locationId: w.orgB.locationId };
    expect((await submit(w.merchant, w.orgA, crf, { secret: generateSecret() })).status).toBe(201);
    const [row] = await sql<{ terminal_id: string; location_id: string }>(w, 'select terminal_id, location_id from merchant.receipts where id = $1', [receiptId]);
    expect(row).toEqual({ terminal_id: w.orgA.terminal.terminalId, location_id: w.orgA.locationId });
  });
});
