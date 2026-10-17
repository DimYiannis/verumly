import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, claimRequest, createReceipt, createWorld, loginUser, type BuyerSession, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

const LINES = [
  { description: 'Koffie', unitPrice: 340, qty: '2', vatRate: 9 as const },
  { description: 'Bier', unitPrice: 389, vatRate: 21 as const },
];
const call = (u: BuyerSession, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => buyerCall(w, method, url, { token: u.token, body });

let n = 0;
async function person(name: string): Promise<BuyerSession & { handle: string }> {
  const u = await loginUser(w);
  const handle = `${name}_${Date.now().toString(36)}${n++}`.slice(0, 20);
  expect((await call(u, 'PUT', '/v1/me/profile', { displayName: name, handle, avatar: null })).status).toBe(200);
  return { ...u, handle };
}

describe('GET /v1/me/home', () => {
  it('is empty for a new person', async () => {
    const u = await loginUser(w);
    const res = await call(u, 'GET', '/v1/me/home');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, receipts: 0, previousToDate: 0, recent: [], currency: 'EUR' });
    const b = res.body as { dayOfMonth: number; daysInMonth: number; daily: number[]; month: string };
    expect(b.daily).toHaveLength(b.dayOfMonth);
    expect(b.daysInMonth).toBeGreaterThanOrEqual(28);
    expect(b.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('sums this month, lists the latest receipts and who they were split with', async () => {
    const a = await person('hanna');
    const b = await person('ivo');
    expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle })).status).toBe(201);
    const inc = (await call(b, 'GET', '/v1/me/friends')).body as { incoming: Array<{ requestId: string }> };
    expect((await buyerCall(w, 'POST', `/v1/me/friends/requests/${inc.incoming[0]!.requestId}/accept`, { token: b.token })).status).toBe(204);

    const r1 = await createReceipt(w, w.orgA, { state: 'paid', lines: LINES });
    const r2 = await createReceipt(w, w.orgA, { state: 'paid', lines: [{ description: 'Bier', unitPrice: 389, vatRate: 21 }] });
    expect((await claimRequest(w, a, r1)).status).toBe(201);
    expect((await claimRequest(w, a, r2)).status).toBe(201);
    const split = await call(a, 'POST', '/v1/me/splits', { receiptId: r1.receiptId, mode: 'equal', participants: [{ userId: b.userId }] });
    expect(split.status).toBe(201);

    const res = await call(a, 'GET', '/v1/me/home');
    const home = res.body as { total: number; receipts: number; daily: number[]; recent: Array<{ receiptId: string; splitWith: string[]; itemCount: number; total: number; merchantName: string }> };
    expect(home.total).toBe(1069 + 389);
    expect(home.receipts).toBe(2);
    expect(home.daily.reduce((s, x) => s + x, 0)).toBe(1458);
    expect(home.recent).toHaveLength(2);
    const withSplit = home.recent.find((x) => x.receiptId === r1.receiptId)!;
    expect(withSplit).toMatchObject({ splitWith: ['ivo'], itemCount: 3, total: 1069, merchantName: 'Café Het Plein' });
    expect(home.recent.find((x) => x.receiptId === r2.receiptId)!.splitWith).toEqual([]);
    // the other person only has the split, not the receipt: nothing in their month
    expect(((await call(b, 'GET', '/v1/me/home')).body as { total: number }).total).toBe(0);
  });

  it('needs a session', async () => {
    expect((await buyerCall(w, 'GET', '/v1/me/home')).status).toBe(401);
    expect((await buyerCall(w, 'GET', '/v1/me/activity')).status).toBe(401);
  });
});

describe('GET /v1/me/activity', () => {
  it('shows friend requests, splits, payments and reactions, newest first, without e-mail addresses', async () => {
    const a = await person('jules');
    const b = await person('kim');
    const c = await person('lars');
    await call(c, 'POST', '/v1/me/friends/requests', { handle: a.handle });
    expect(((await call(a, 'GET', '/v1/me/activity')).body as { items: Array<{ kind: string }> }).items.map((i) => i.kind)).toContain('friend_request');

    await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle });
    const inc = (await call(b, 'GET', '/v1/me/friends')).body as { incoming: Array<{ requestId: string }> };
    await buyerCall(w, 'POST', `/v1/me/friends/requests/${inc.incoming[0]!.requestId}/accept`, { token: b.token });

    const r = await createReceipt(w, w.orgA, { state: 'paid', lines: LINES });
    await claimRequest(w, a, r);
    const split = (await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', participants: [{ userId: b.userId }] })).body as { id: string; shares: Array<{ id: string; isMe: boolean }> };
    const share = (await call(a, 'POST', '/v1/me/shares', { receiptId: r.receiptId, friendId: b.userId })).body as { id: string };
    await call(b, 'PUT', `/v1/me/shares/${share.id}/reaction`, { emoji: '👍' });

    const forB = (await call(b, 'GET', '/v1/me/activity')).body as { items: Array<{ kind: string; user: { handle: string } | null; amountMinor: number | null; splitId: string | null }> };
    expect(forB.items.map((i) => i.kind)).toEqual(expect.arrayContaining(['friend_added', 'share_received', 'split_with_me']));
    expect(forB.items.find((i) => i.kind === 'split_with_me')).toMatchObject({ user: { handle: a.handle }, splitId: split.id });

    const other = split.shares.find((s) => !s.isMe)!;
    await call(b, 'PUT', `/v1/me/splits/${split.id}/shares/${other.id}/settled`, { settled: true });

    const forA = (await call(a, 'GET', '/v1/me/activity')).body as { items: Array<{ kind: string; at: string; emoji: string | null; amountMinor: number | null }> };
    const kinds = forA.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['friend_added', 'split_created', 'paid_you', 'reaction', 'friend_request']));
    expect(forA.items.find((i) => i.kind === 'reaction')?.emoji).toBe('👍');
    expect(forA.items.find((i) => i.kind === 'paid_you')?.amountMinor).toBe(534);
    const times = forA.items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(JSON.stringify(forA)).not.toContain('@example.test');
  });
});
