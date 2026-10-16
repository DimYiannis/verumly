import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, claimRequest, createReceipt, createWorld, loginUser, resolveRequest, sql, type World } from '../../../scripts/lib/testkit.ts';

// Evidence for the threat list in docs/findings/integration.md. These tests pin the ACTUAL behaviour.

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

describe('threat: shared or forwarded receipt link', () => {
  it('someone else holding the link can read the receipt but cannot take it from the owner', async () => {
    const r = await createReceipt(w, w.orgA);
    const owner = await loginUser(w);
    const forwardedTo = await loginUser(w);
    expect((await claimRequest(w, owner, r)).status).toBe(201);

    // actual behaviour: the link keeps working as a read-only view for anyone who has the secret…
    const view = await resolveRequest(w, r, 'view');
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ status: 'ok', preview: { claimed: true }, receipt: { receiptId: r.receiptId } });
    // …but it can no longer be claimed, and it is not added to the other person's wallet
    expect((await claimRequest(w, forwardedTo, r)).status).toBe(409);
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: forwardedTo.token })).body).toMatchObject({ items: [] });
    expect((await buyerCall(w, 'GET', `/v1/me/receipts/${r.receiptId}`, { token: forwardedTo.token })).status).toBe(404);
    // the owner is unchanged
    expect(await sql(w, 'select user_id from buyer.claims where receipt_id = $1', [r.receiptId])).toEqual([{ user_id: owner.userId }]);
  });

  it('before anyone claims, the first holder of the link to claim wins (a shoulder-surfed QR can be claimed first)', async () => {
    const r = await createReceipt(w, w.orgA);
    const thief = await loginUser(w);
    const customer = await loginUser(w);
    expect((await claimRequest(w, thief, r)).status).toBe(201);
    expect((await claimRequest(w, customer, r)).status).toBe(409);
  });
});

describe('threat: terminal clock backdating', () => {
  const days = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 86_400_000;

  it('the claim window runs from the server received_at, not from the terminal-supplied createdAt', async () => {
    const old = await createReceipt(w, w.orgA, { createdAt: '2020-01-01T10:00:00.000Z' });
    const future = await createReceipt(w, w.orgA, { createdAt: '2099-01-01T10:00:00.000Z' });
    const normal = await createReceipt(w, w.orgA);

    const rows = await sql<{ id: string; created: Date; received: Date; until: Date }>(
      w,
      'select id, created_on_terminal_at created, received_at received, claimable_until until from merchant.receipts where id = any($1::uuid[])',
      [[old.receiptId, future.receiptId, normal.receiptId]],
    );
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    for (const r of [old, future, normal]) {
      const row = byId[r.receiptId]!;
      expect(days(row.until, row.received)).toBeCloseTo(90, 6);
    }
    // the terminal-supplied time is stored as sent: the server does not check it against its own clock
    expect(byId[old.receiptId]!.created.getUTCFullYear()).toBe(2020);
    expect(byId[future.receiptId]!.created.getUTCFullYear()).toBe(2099);
    expect(days(new Date(), byId[old.receiptId]!.received)).toBeLessThan(1);

    // a backdated receipt is still claimable today (a createdAt-based window would have rejected it), and so is a future-dated one
    const user = await loginUser(w);
    expect((await claimRequest(w, user, old)).status).toBe(201);
    expect((await claimRequest(w, user, future)).status).toBe(201);
  });

  it('what the terminal clock DOES control: where the receipt sorts and which date filter it matches in the wallet', async () => {
    const user = await loginUser(w);
    const old = await createReceipt(w, w.orgA, { createdAt: '2020-03-04T10:00:00.000Z' });
    await claimRequest(w, user, old);
    const inRange = await buyerCall(w, 'GET', '/v1/me/receipts?from=2020-03-04&to=2020-03-04', { token: user.token });
    expect(inRange.body).toMatchObject({ items: [{ receiptId: old.receiptId, createdAt: '2020-03-04T10:00:00.000Z' }] });
  });
});
