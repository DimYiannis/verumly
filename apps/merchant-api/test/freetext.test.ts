import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, hashSecret, newReceiptId, signPayload } from '@lr/crypto';
import { buildCrf, createWorld, merchantPost, sql, submit, type World } from '../../../scripts/lib/testkit.ts';

// Threat: free text that could carry identifiers (v2 §2.2). What the SERVER enforces; the SDK scrubbing is tested in terminal-sdk.

let w: World;
beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

/** Sign `crf` after `mutate` edits a copy, so only the signature-valid, schema-checked path is exercised. */
async function post(mutate: (crf: Record<string, unknown>) => void, state: 'presented' | 'paid' = 'presented') {
  const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state, org: w.orgA });
  const edited: Record<string, unknown> = structuredClone(crf);
  mutate(edited);
  const body = { version: edited, signature: signPayload(w.orgA.terminal.keys.privateKey, edited), claimSecretHash: hashSecret(generateSecret()) };
  const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: `free-${crf.receiptId}` });
  return { res, receiptId: crf.receiptId };
}

describe('the CRF has no free-text field', () => {
  it.each(['notes', 'note', 'customer', 'customerName', 'loyaltyCard', 'pan', 'email', 'phone'])('a top-level "%s" is rejected (400) and nothing is stored', async (key) => {
    const { res, receiptId } = await post((c) => {
      c[key] = 'Jan Jansen 4111111111111111';
    });
    expect(res.status).toBe(400);
    expect(await sql(w, 'select 1 from merchant.receipts where id = $1', [receiptId])).toHaveLength(0);
  });

  it.each([['lines.0', 'customerName'], ['merchant', 'email'], ['totals', 'note'], ['payments.0', 'pan'], ['fiscal', 'loyaltyCard']])('an unknown key under %s (%s) is rejected', async (path, key) => {
    const { res } = await post((c) => {
      let target: unknown = c;
      for (const part of path.split('.')) target = Reflect.get(Object(target), part);
      Reflect.set(Object(target), key, 'x');
    }, 'paid');
    expect(res.status).toBe(400);
  });

  it('a line description over 80 characters is rejected', async () => {
    const { res } = await post((c) => {
      Reflect.set(Object(Reflect.get(c, 'lines'))[0], 'description', 'x'.repeat(81));
    });
    expect(res.status).toBe(400);
  });

  it('exactly 80 characters is accepted', async () => {
    const { res } = await post((c) => {
      Reflect.set(Object(Reflect.get(c, 'lines'))[0], 'description', 'x'.repeat(80));
    });
    expect(res.status).toBe(201);
  });
});

describe('residual free-text channels (documented, NOT closed by the server)', () => {
  it('the server does not inspect permitted text fields: a description or fiscal.extra value that looks like a card number is stored as sent', async () => {
    const { res, receiptId } = await post((c) => {
      Reflect.set(Object(Reflect.get(c, 'lines'))[0], 'description', 'Koffie 4111 **** **** 1111');
      Reflect.set(Object(Reflect.get(c, 'fiscal')), 'extra', { tag: 'Jan Jansen pas 1234567890123' });
    });
    expect(res.status).toBe(201);
    const [row] = await sql<{ description: string }>(w, 'select description from merchant.receipt_lines where receipt_id = $1', [receiptId]);
    expect(row?.description).toBe('Koffie 4111 **** **** 1111');
    const [v] = await sql<{ extra: Record<string, string> }>(w, "select payload->'fiscal'->'extra' as extra from merchant.receipt_versions where receipt_id = $1", [receiptId]);
    expect(v?.extra).toEqual({ tag: 'Jan Jansen pas 1234567890123' });
  });

  it('fiscal.extra is bounded: more than 12 keys or a value over 200 characters is rejected', async () => {
    const many = await post((c) => {
      Reflect.set(Object(Reflect.get(c, 'fiscal')), 'extra', Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'v'])));
    });
    expect(many.res.status).toBe(400);
    const long = await post((c) => {
      Reflect.set(Object(Reflect.get(c, 'fiscal')), 'extra', { k: 'x'.repeat(201) });
    });
    expect(long.res.status).toBe(400);
  });

  it('unchanged control: the same receipt without edits is accepted', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    expect((await submit(w.merchant, w.orgA, crf, { secret: generateSecret() })).status).toBe(201);
  });
});
