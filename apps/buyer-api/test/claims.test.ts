import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, newReceiptId } from '@lr/crypto';
import { buyerCall, claimRequest, createReceipt, createWorld, loginUser, resolveRequest, sql, submit, buildCrf, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

describe('claims', () => {
  it('success: 201 claimed, the receipt shows up in the wallet, and resolve now reports claimed=true', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    const res = await claimRequest(w, user, r, 'link');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ receiptId: r.receiptId, status: 'claimed' });
    const [row] = await sql<{ user_id: string; source: string }>(w, 'select user_id, source from buyer.claims where receipt_id = $1', [r.receiptId]);
    expect(row).toEqual({ user_id: user.userId, source: 'link' });
    const list = await buyerCall(w, 'GET', '/v1/me/receipts', { token: user.token });
    expect(list.body).toMatchObject({ items: [{ receiptId: r.receiptId, state: 'presented', total: 680, merchantName: 'Café Het Plein' }] });
    expect((await resolveRequest(w, r)).body).toMatchObject({ preview: { claimed: true } });
  });

  it('the audit log records the receipt id for a claim but never the user id or e-mail', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    await claimRequest(w, user, r);
    const rows = await sql<{ row: string }>(w, "select row_to_json(a)::text row from ops.audit_log a where event = 'claim' and receipt_id = $1", [r.receiptId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row).not.toContain(user.userId);
    expect(rows[0]?.row).not.toContain(user.email);
  });

  it('a second user cannot claim a claimed receipt: 409 already_claimed (even with the correct secret)', async () => {
    const r = await createReceipt(w, w.orgA);
    const first = await loginUser(w);
    const second = await loginUser(w);
    expect((await claimRequest(w, first, r)).status).toBe(201);
    const res = await claimRequest(w, second, r);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_claimed' });
    const rows = await sql<{ user_id: string }>(w, 'select user_id from buyer.claims where receipt_id = $1', [r.receiptId]);
    expect(rows).toEqual([{ user_id: first.userId }]);
    // and the receipt is not visible in the second user's wallet
    expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: second.token })).body).toMatchObject({ items: [] });
    expect((await buyerCall(w, 'GET', `/v1/me/receipts/${r.receiptId}`, { token: second.token })).status).toBe(404);
  });

  it('the same user claiming again is idempotent: 200 already_yours, one claim row, one audit entry', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    expect((await claimRequest(w, user, r)).status).toBe(201);
    for (let i = 0; i < 3; i++) {
      const again = await claimRequest(w, user, r);
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ receiptId: r.receiptId, status: 'already_yours' });
    }
    expect(await sql(w, 'select 1 from buyer.claims where receipt_id = $1', [r.receiptId])).toHaveLength(1);
    expect(await sql(w, "select 1 from ops.audit_log where event = 'claim' and receipt_id = $1", [r.receiptId])).toHaveLength(1);
  });

  it('a wrong secret never claims: 404; an unknown receipt: 404; no token: 401', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    const wrong = await buyerCall(w, 'POST', '/v1/me/claims', { token: user.token, body: { receiptId: r.receiptId, secret: generateSecret() } });
    expect(wrong.status).toBe(404);
    const unknown = await buyerCall(w, 'POST', '/v1/me/claims', { token: user.token, body: { receiptId: newReceiptId(), secret: generateSecret() } });
    expect(unknown.status).toBe(404);
    const anon = await buyerCall(w, 'POST', '/v1/me/claims', { body: { receiptId: r.receiptId, secret: r.secret } });
    expect(anon.status).toBe(401);
    const badToken = await buyerCall(w, 'POST', '/v1/me/claims', { token: generateSecret(), body: { receiptId: r.receiptId, secret: r.secret } });
    expect(badToken.status).toBe(401);
    expect(await sql(w, 'select 1 from buyer.claims where receipt_id = $1', [r.receiptId])).toHaveLength(0);
  });

  it('source must be qr or link (photo_match is server-assigned only)', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    const res = await buyerCall(w, 'POST', '/v1/me/claims', { token: user.token, body: { receiptId: r.receiptId, secret: r.secret, source: 'photo_match' } });
    expect(res.status).toBe(400);
  });

  it('a logged-out session can no longer claim', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    expect((await buyerCall(w, 'POST', '/v1/auth/logout', { token: user.token })).status).toBe(204);
    expect((await claimRequest(w, user, r)).status).toBe(401);
  });

  it('a claimed receipt keeps updating for its owner: v2 paid is final in the wallet', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    await claimRequest(w, user, r);
    await submit(w.merchant, w.orgA, buildCrf({ receiptId: r.receiptId, version: 2, state: 'paid', org: w.orgA }));
    const detail = await buyerCall(w, 'GET', `/v1/me/receipts/${r.receiptId}`, { token: user.token });
    expect(detail.body).toMatchObject({ final: true, receipt: { version: 2, state: 'paid' }, versions: [{ version: 1 }, { version: 2 }] });
  });
});

describe('claim expiry', () => {
  it('claimable_until = server received_at + CLAIM_WINDOW_DAYS (claimWindowDays dep)', async () => {
    const short = await createWorld({ claimWindowDays: 3 });
    try {
      const r = await createReceipt(short, short.orgA);
      const [row] = await sql<{ days: string }>(short, "select extract(epoch from claimable_until - received_at) / 86400 as days from merchant.receipts where id = $1", [r.receiptId]);
      expect(Number(row?.days)).toBeCloseTo(3, 6);
    } finally {
      await short.close();
    }
  }, 120_000);

  it('claimWindowDays = 0: the window is already closed → 410 claim_expired, nothing claimed', async () => {
    const closed = await createWorld({ claimWindowDays: 0 });
    try {
      const r = await createReceipt(closed, closed.orgA);
      const user = await loginUser(closed);
      const res = await claimRequest(closed, user, r);
      expect(res.status).toBe(410);
      expect(res.body).toEqual({ error: 'claim_expired' });
      expect(await sql(closed, 'select 1 from buyer.claims')).toHaveLength(0);
      // an expired receipt still resolves (read-only link) but cannot be saved
      expect((await resolveRequest(closed, r)).body).toMatchObject({ status: 'ok' });
    } finally {
      await closed.close();
    }
  }, 120_000);

  it('claimable_until moved into the past through the admin pool → 410; claimed receipts stay with their owner', async () => {
    const unclaimed = await createReceipt(w, w.orgA);
    const claimed = await createReceipt(w, w.orgA);
    const owner = await loginUser(w);
    const stranger = await loginUser(w);
    expect((await claimRequest(w, owner, claimed)).status).toBe(201);

    await sql(w, "update merchant.receipts set claimable_until = now() - interval '1 second' where id = any($1::uuid[])", [[unclaimed.receiptId, claimed.receiptId]]);

    const late = await claimRequest(w, stranger, unclaimed);
    expect(late.status).toBe(410);
    expect(late.body).toEqual({ error: 'claim_expired' });
    // expiry does not take a receipt away from the person who claimed it in time
    expect((await claimRequest(w, owner, claimed)).status).toBe(200);
    expect((await claimRequest(w, stranger, claimed)).status).toBe(409);
    expect((await buyerCall(w, 'GET', `/v1/me/receipts/${claimed.receiptId}`, { token: owner.token })).status).toBe(200);
  });

  it('a receipt one second before expiry can still be claimed', async () => {
    const r = await createReceipt(w, w.orgA);
    await sql(w, "update merchant.receipts set claimable_until = now() + interval '5 seconds' where id = $1", [r.receiptId]);
    const user = await loginUser(w);
    expect((await claimRequest(w, user, r)).status).toBe(201);
  });
});

describe('claim race', () => {
  it('16 different users claim one receipt at the same instant: exactly one 201, fifteen 409, one claims row', async () => {
    const r = await createReceipt(w, w.orgA);
    const users = await Promise.all(Array.from({ length: 16 }, () => loginUser(w)));
    const results = await Promise.all(users.map((u) => claimRequest(w, u, r)));
    const winners = results.flatMap((res, i) => (res.status === 201 ? [users[i]!] : []));
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409)).toHaveLength(15);
    expect(results.every((x) => x.status === 201 || (x.status === 409 && JSON.stringify(x.body) === '{"error":"already_claimed"}'))).toBe(true);
    const rows = await sql<{ user_id: string }>(w, 'select user_id from buyer.claims where receipt_id = $1', [r.receiptId]);
    expect(rows).toEqual([{ user_id: winners[0]!.userId }]);
    expect(await sql(w, "select 1 from ops.audit_log where event = 'claim' and receipt_id = $1", [r.receiptId])).toHaveLength(1);
  });

  it('the same user claiming in parallel from several devices: one 201, the rest 200 already_yours', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    const results = await Promise.all(Array.from({ length: 8 }, () => claimRequest(w, user, r)));
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(results.filter((x) => x.status === 200)).toHaveLength(7);
    expect(await sql(w, 'select 1 from buyer.claims where receipt_id = $1', [r.receiptId])).toHaveLength(1);
  });

  it('many receipts, many users, interleaved: every receipt ends up with exactly one owner', async () => {
    const receipts = await Promise.all(Array.from({ length: 5 }, () => createReceipt(w, w.orgA)));
    const users = await Promise.all(Array.from({ length: 6 }, () => loginUser(w)));
    await Promise.all(receipts.flatMap((r) => users.map((u) => claimRequest(w, u, r))));
    for (const r of receipts) {
      expect(await sql(w, 'select 1 from buyer.claims where receipt_id = $1', [r.receiptId])).toHaveLength(1);
    }
  });
});
