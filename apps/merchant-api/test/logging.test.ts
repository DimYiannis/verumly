import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, hashSecret, newReceiptId, signBytes } from '@lr/crypto';
import { buildCrf, createWorld, merchantGet, merchantPost, signedBody, submit, type World } from '../../../scripts/lib/testkit.ts';

// v2 §2.9 / §14: logs contain request ids only: never secrets, tokens, e-mails or receipt content.

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

describe('merchant-api logs', () => {
  it('after successful, rejected and malformed traffic the log holds no credential, signature, hash, secret or receipt content', async () => {
    const org = w.orgA;
    const secret = generateSecret();
    const receiptId = newReceiptId();
    const crf = buildCrf({ receiptId, version: 1, state: 'presented', org, lines: [{ sku: 'SKU-UNIQUE-77', description: 'Koffie verkeerd uniek', unitPrice: 340, vatRate: 9 }] });
    const body = signedBody(org, crf, secret);
    await merchantPost(w.merchant, org, '/v1/receipts', body, { idempotencyKey: 'logtest-create-1' });
    await merchantPost(w.merchant, org, '/v1/receipts', body, { idempotencyKey: 'logtest-create-1' }); // replay
    await merchantGet(w.merchant, org, `/v1/receipts/${receiptId}`);
    await merchantPost(w.merchant, org, '/v1/receipts', body, { idempotencyKey: 'logtest-badsig-1', signWith: w.orgB.terminal.keys.privateKey });
    await merchantPost(w.merchant, org, '/v1/receipts', '{"not json', { idempotencyKey: 'logtest-badjson-1' });
    await submit(w.merchant, org, buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org, lines: [{ description: 'Jan Jansen 4111111111111111', unitPrice: 1, vatRate: 9 }] }), { secret: generateSecret(), idempotencyKey: 'logtest-422-1' });
    const tampered = { ...body, version: { ...crf, notes: 'Jan Jansen' } };
    await merchantPost(w.merchant, org, '/v1/receipts', { ...tampered, signature: signBytes(org.terminal.keys.privateKey, new Uint8Array([1])) }, { idempotencyKey: 'logtest-unknown-key' });
    await merchantGet(w.merchant, org, '/v1/terminals/me', { apiKey: 'wrong-wrong-wrong-wrong-wrong-key' });

    const log = w.logs.lines.join('');
    expect(log.length).toBeGreaterThan(500); // it really logged something
    for (const secretValue of [
      org.terminal.apiKey,
      secret,
      hashSecret(secret),
      body.signature,
      'Koffie',
      'SKU-UNIQUE-77',
      'Jan Jansen',
      '4111111111111111',
      'wrong-wrong-wrong-wrong-wrong-key',
      'logtest-create-1', // idempotency keys are request metadata, but they embed receipt ids; keep them out too
      'claimSecretHash',
    ]) {
      expect(log, `"${secretValue.slice(0, 12)}…" leaked into the log`).not.toContain(secretValue);
    }
    // every line is JSON with a request id
    for (const line of w.logs.lines.join('').split('\n').filter(Boolean)) {
      const parsed: unknown = JSON.parse(line);
      expect(parsed).toMatchObject({ level: expect.any(Number) });
    }
  });
});
