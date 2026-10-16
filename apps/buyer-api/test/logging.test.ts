import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret } from '@lr/crypto';
import { buyerCall, claimRequest, createReceipt, createWorld, loginUser, resolveRequest, type World } from '../../../scripts/lib/testkit.ts';

// v2 §2.9 / §14: logs contain request ids only: never secrets, tokens, e-mails or receipt content.

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 3 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

describe('buyer-api logs', () => {
  it('login, claim, resolve (ok, wrong secret, rate-limited) leave no e-mail, code, token, secret or receipt content in the log', async () => {
    const email = `logging-${Date.now()}@example.test`;
    const r = await createReceipt(w, w.orgA, { lines: [{ sku: 'UNIQ-SKU-9', description: 'Koffie verkeerd uniek', unitPrice: 340, vatRate: 9 }] });
    const user = await loginUser(w, email);
    await buyerCall(w, 'POST', '/v1/auth/email/verify', { body: { email, code: '000000' } }); // failed verification
    await claimRequest(w, user, r);
    await buyerCall(w, 'GET', '/v1/me/receipts', { token: user.token });
    await buyerCall(w, 'GET', `/v1/me/receipts/${r.receiptId}`, { token: user.token });
    const wrong = generateSecret();
    for (let i = 0; i < 5; i++) await resolveRequest(w, { receiptId: r.receiptId, secret: i % 2 ? wrong : r.secret }, i % 2 ? 'view' : 'secret'); // includes 429s
    await buyerCall(w, 'GET', '/v1/me/receipts', { token: 'x'.repeat(43) });

    const log = w.logs.lines.join('');
    expect(log.length).toBeGreaterThan(500);
    const code = w.codes[email]!;
    for (const value of [email, email.split('@')[0]!, user.token, r.secret, wrong, 'Koffie', 'UNIQ-SKU-9', user.userId]) {
      expect(log, `"${value.slice(0, 12)}…" leaked into the log`).not.toContain(value);
    }
    expect(log).not.toContain(`"code":"${code}"`);
    // the request URL carries the receipt id only in the path (never a secret: that lives in the URL fragment / body)
    expect(log).toContain(r.receiptId);
  });
});
