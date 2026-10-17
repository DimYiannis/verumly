import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, claimRequest, createReceipt, createWorld, loginUser, sql, type BuyerSession, type World } from '../../../scripts/lib/testkit.ts';

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

const call = (u: BuyerSession, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => buyerCall(w, method, url, { token: u.token, body });

let n = 0;
async function person(name: string): Promise<BuyerSession & { handle: string }> {
  const u = await loginUser(w);
  const handle = `${name}_${Date.now().toString(36)}${n++}`.slice(0, 20);
  const res = await call(u, 'PUT', '/v1/me/profile', { displayName: name, handle, avatar: '🙂' });
  expect(res.status).toBe(200);
  return { ...u, handle };
}

async function befriend(a: BuyerSession, b: { handle: string; token: string }) {
  expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle })).status).toBe(201);
  const inc = (await buyerCall(w, 'GET', '/v1/me/friends', { token: b.token })).body as { incoming: Array<{ requestId: string }> };
  expect((await buyerCall(w, 'POST', `/v1/me/friends/requests/${inc.incoming[0]!.requestId}/accept`, { token: b.token })).status).toBe(204);
}

async function savedReceipt(owner: BuyerSession) {
  const r = await createReceipt(w, w.orgA, { state: 'paid', lines: LINES });
  expect((await claimRequest(w, owner, r)).status).toBe(201);
  return r;
}

describe('profile and friends', () => {
  it('handle is unique, lowercase and shaped; the e-mail never reaches a friend', async () => {
    const a = await person('anna');
    const b = await loginUser(w);
    expect((await call(b, 'PUT', '/v1/me/profile', { displayName: 'Bram', handle: a.handle })).status).toBe(409);
    expect((await call(b, 'PUT', '/v1/me/profile', { displayName: 'Bram', handle: 'No Spaces' })).status).toBe(400);
    await call(b, 'PUT', '/v1/me/profile', { displayName: 'Bram', handle: `bram_${Date.now().toString(36)}` });
    await befriend(a, { handle: ((await call(b, 'GET', '/v1/me/profile')).body as { handle: string }).handle, token: b.token });
    const friends = await call(a, 'GET', '/v1/me/friends');
    expect(friends.status).toBe(200);
    expect(JSON.stringify(friends.body)).not.toContain(b.email);
    expect((friends.body as { friends: unknown[] }).friends).toHaveLength(1);
  });

  it('request flow: unknown handle 404, self 409, repeat 409, asking back accepts, decline removes', async () => {
    const a = await person('carl');
    const b = await person('dora');
    expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: 'nobody_here_xx' })).status).toBe(404);
    expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: a.handle })).status).toBe(409);
    expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle })).status).toBe(201);
    expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle })).body).toEqual({ error: 'already_requested' });
    const back = await call(b, 'POST', '/v1/me/friends/requests', { handle: a.handle });
    expect(back.body).toEqual({ status: 'accepted' });
    expect((await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle })).body).toEqual({ error: 'already_friends' });

    const c = await person('emil');
    await call(c, 'POST', '/v1/me/friends/requests', { handle: a.handle });
    const inc = (await call(a, 'GET', '/v1/me/friends')).body as { incoming: Array<{ requestId: string }> };
    expect((await call(a, 'POST', `/v1/me/friends/requests/${inc.incoming[0]!.requestId}/decline`)).status).toBe(204);
    expect(((await call(a, 'GET', '/v1/me/friends')).body as { incoming: unknown[] }).incoming).toHaveLength(0);
  });

  it('a stranger cannot accept somebody else’s request', async () => {
    const a = await person('fien');
    const b = await person('gijs');
    const thief = await person('hans');
    await call(a, 'POST', '/v1/me/friends/requests', { handle: b.handle });
    const inc = (await call(b, 'GET', '/v1/me/friends')).body as { incoming: Array<{ requestId: string }> };
    expect((await call(thief, 'POST', `/v1/me/friends/requests/${inc.incoming[0]!.requestId}/accept`)).status).toBe(404);
  });

  it('invite link: a new user becomes a friend; single use; not for yourself', async () => {
    const a = await person('iris');
    const b = await person('joris');
    const inv = (await call(a, 'POST', '/v1/me/invites')).body as { code: string };
    expect((await call(a, 'POST', '/v1/me/invites/accept', { code: inv.code })).body).toEqual({ error: 'self' });
    const ok = await call(b, 'POST', '/v1/me/invites/accept', { code: inv.code });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ friend: { userId: a.userId }, splitId: null });
    expect(((await call(b, 'GET', '/v1/me/friends')).body as { friends: unknown[] }).friends).toHaveLength(1);
    const again = await call(await person('kees'), 'POST', '/v1/me/invites/accept', { code: inv.code });
    expect(again.status).toBe(404);
  });
});

describe('sharing a receipt', () => {
  it('only the person who saved it can share, only with a friend; the friend sees it and can react', async () => {
    const a = await person('lotte');
    const b = await person('mees');
    const stranger = await person('noor');
    await befriend(a, b);
    const r = await savedReceipt(a);

    expect((await call(b, 'POST', '/v1/me/shares', { receiptId: r.receiptId, friendId: a.userId })).status).toBe(404); // b never saved it
    expect((await call(a, 'POST', '/v1/me/shares', { receiptId: r.receiptId, friendId: stranger.userId })).status).toBe(403);
    const made = await call(a, 'POST', '/v1/me/shares', { receiptId: r.receiptId, friendId: b.userId });
    expect(made.status).toBe(201);
    const id = (made.body as { id: string }).id;
    expect((await call(a, 'POST', '/v1/me/shares', { receiptId: r.receiptId, friendId: b.userId })).body).toEqual({ id }); // idempotent

    const list = await call(b, 'GET', '/v1/me/shares');
    expect(list.body).toMatchObject({ incoming: [{ id, receiptId: r.receiptId, merchantName: 'Café Het Plein', total: 1069 }] });
    const detail = await call(b, 'GET', `/v1/me/shares/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ receipt: { receiptId: r.receiptId } });
    expect((await call(stranger, 'GET', `/v1/me/shares/${id}`)).status).toBe(404);

    expect((await call(b, 'PUT', `/v1/me/shares/${id}/reaction`, { emoji: '❤️' })).status).toBe(204);
    expect((await call(a, 'GET', `/v1/me/shares/${id}`)).body).toMatchObject({ reactions: [{ emoji: '❤️', user: { userId: b.userId } }] });
    expect((await call(b, 'PUT', `/v1/me/shares/${id}/reaction`, { emoji: null })).status).toBe(204);
    expect((await call(b, 'PUT', `/v1/me/shares/${id}/reaction`, { emoji: '💩' })).status).toBe(400);
  });
});

describe('splitting a bill', () => {
  it('equal split with a friend and a guest: shares add up, guest slot gets an invite, balances follow', async () => {
    const a = await person('olga');
    const b = await person('pieter');
    await befriend(a, b);
    const r = await savedReceipt(a);

    const res = await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', includeMe: true, participants: [{ userId: b.userId }, { guestName: 'Quinn' }] });
    expect(res.status).toBe(201);
    const split = res.body as { id: string; totalMinor: number; shares: Array<{ id: string; amountMinor: number; isMe: boolean; settled: boolean; guestName: string | null; inviteCode: string | null }> };
    expect(split.totalMinor).toBe(1069);
    expect(split.shares.reduce((s, x) => s + x.amountMinor, 0)).toBe(1069);
    expect(split.shares.find((s) => s.isMe)?.settled).toBe(true);
    const guest = split.shares.find((s) => s.guestName === 'Quinn')!;
    expect(guest.inviteCode).toEqual(expect.any(String));

    // balances: Pieter owes Olga his share; Olga is owed that plus the guest (guest has no account yet)
    const mine = split.shares.find((s) => !s.isMe && s.guestName === null)!;
    expect((await call(a, 'GET', '/v1/me/balances')).body).toMatchObject({ totalOwedToMe: mine.amountMinor, friends: [{ owesMe: mine.amountMinor, iOwe: 0 }] });
    expect((await call(b, 'GET', '/v1/me/balances')).body).toMatchObject({ totalIOwe: mine.amountMinor, friends: [{ owesMe: 0, iOwe: mine.amountMinor }] });

    // Pieter sees the split, marks his share settled, balances drop to zero
    expect((await call(b, 'GET', `/v1/me/splits/${split.id}`)).status).toBe(200);
    const settled = await call(b, 'PUT', `/v1/me/splits/${split.id}/shares/${mine.id}/settled`, { settled: true });
    expect(settled.status).toBe(200);
    expect((await call(a, 'GET', '/v1/me/balances')).body).toMatchObject({ totalOwedToMe: 0, friends: [] });
    expect((await call(b, 'PUT', `/v1/me/splits/${split.id}/shares/${mine.id}/settled`, { settled: false })).status).toBe(200);

    // the guest joins through the invite link and takes the slot
    const guestUser = await person('quinn');
    const joined = await call(guestUser, 'POST', '/v1/me/invites/accept', { code: guest.inviteCode });
    expect(joined.body).toMatchObject({ friend: { userId: a.userId }, splitId: split.id });
    expect((await call(guestUser, 'GET', `/v1/me/splits/${split.id}`)).status).toBe(200);
    expect((await call(guestUser, 'GET', '/v1/me/balances')).body).toMatchObject({ totalIOwe: guest.amountMinor });
  });

  it('items split: lines go to the right people and tip/rounding are spread', async () => {
    const a = await person('rosa');
    const b = await person('sven');
    await befriend(a, b);
    const r = await savedReceipt(a);
    const res = await call(a, 'POST', '/v1/me/splits', {
      receiptId: r.receiptId,
      mode: 'items',
      includeMe: true,
      participants: [{ userId: b.userId }],
      assignments: [{ lineNo: 1, who: ['me'] }, { lineNo: 2, who: ['p0'] }],
    });
    expect(res.status).toBe(201);
    const shares = (res.body as { shares: Array<{ isMe: boolean; amountMinor: number; lineNos: number[] }> }).shares;
    expect(shares.find((s) => s.isMe)).toMatchObject({ amountMinor: 680, lineNos: [1] });
    expect(shares.find((s) => !s.isMe)).toMatchObject({ amountMinor: 389, lineNos: [2] });
    const missing = await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'items', participants: [{ userId: b.userId }], assignments: [{ lineNo: 1, who: ['me'] }] });
    expect(missing.status).toBe(400);
  });

  it('rules: only your own saved receipt, only friends, custom amounts must add up, a void receipt cannot be split', async () => {
    const a = await person('tess');
    const b = await person('uli');
    const other = await person('vera');
    await befriend(a, b);
    const r = await savedReceipt(a);
    expect((await call(other, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', participants: [{ userId: b.userId }] })).status).toBe(404);
    expect((await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', participants: [{ userId: other.userId }] })).status).toBe(403);
    expect((await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'custom', participants: [{ userId: b.userId }], amounts: [{ who: 'me', amount: 1 }, { who: 'p0', amount: 1 }] })).status).toBe(400);
    expect((await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', participants: [{ userId: a.userId }] })).status).toBe(400);
    expect((await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', participants: [{ userId: b.userId, guestName: 'x' }] })).status).toBe(400);
  });

  it('only people in a split can see it; the creator can delete it; a participant cannot settle someone else’s share', async () => {
    const a = await person('wim');
    const b = await person('xena');
    const c = await person('yara');
    await befriend(a, b);
    await befriend(a, c);
    const r = await savedReceipt(a);
    const split = (await call(a, 'POST', '/v1/me/splits', { receiptId: r.receiptId, mode: 'equal', participants: [{ userId: b.userId }, { userId: c.userId }] })).body as {
      id: string;
      shares: Array<{ id: string; who: { userId: string } | null }>;
    };
    const outsider = await person('zed');
    expect((await call(outsider, 'GET', `/v1/me/splits/${split.id}`)).status).toBe(404);
    const shareOfC = split.shares.find((s) => s.who?.userId === c.userId)!;
    expect((await call(b, 'PUT', `/v1/me/splits/${split.id}/shares/${shareOfC.id}/settled`, { settled: true })).status).toBe(404);
    expect((await call(b, 'DELETE', `/v1/me/splits/${split.id}`)).status).toBe(404);
    expect((await call(a, 'DELETE', `/v1/me/splits/${split.id}`)).status).toBe(204);
    expect((await call(b, 'GET', `/v1/me/splits/${split.id}`)).status).toBe(404);
  });

  it('nothing here is reachable without a session, and merchant data stays free of friends and splits', async () => {
    expect((await buyerCall(w, 'GET', '/v1/me/friends')).status).toBe(401);
    expect((await buyerCall(w, 'GET', '/v1/me/splits')).status).toBe(401);
    const cols = await sql<{ c: string }>(w, "select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'merchant' and column_name ~* '(friend|split|handle|share)'");
    expect(cols).toEqual([]);
  });
});
