import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, claimRequest, createReceipt, createWorld, loginUser, sql, type BuyerSession, type World } from '../../../scripts/lib/testkit.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

const call = (u: BuyerSession, method: 'GET' | 'POST', url: string, body?: unknown) => buyerCall(w, method, url, { token: u.token, body });

/** Sam (the creator) and Anna, friends, and a saved receipt of 5 beers and a pizza. */
async function setup() {
  const mk = async (name: string) => {
    const u = await loginUser(w);
    const handle = `${name}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`.slice(0, 20);
    const res = await buyerCall(w, 'PUT', '/v1/me/profile', { token: u.token, body: { displayName: name, handle, avatar: null } });
    expect(res.status).toBe(200);
    return { ...u, handle };
  };
  const sam = await mk('sam');
  const anna = await mk('anna');
  expect((await call(sam, 'POST', '/v1/me/friends/requests', { handle: anna.handle })).status).toBe(201);
  const inc = (await buyerCall(w, 'GET', '/v1/me/friends', { token: anna.token })).body as { incoming: Array<{ requestId: string }> };
  expect((await buyerCall(w, 'POST', `/v1/me/friends/requests/${inc.incoming[0]!.requestId}/accept`, { token: anna.token })).status).toBe(204);
  const receipt = await createReceipt(w, w.orgA, {
    state: 'paid',
    lines: [
      { description: 'Bier', unitPrice: 350, qty: '5', vatRate: 21 },
      { description: 'Pizza', unitPrice: 800, vatRate: 9 },
    ],
  });
  expect((await claimRequest(w, sam, receipt)).status).toBe(201);
  return { sam, anna, receipt };
}

describe('POST /v1/me/splits: items split by quantity', () => {
  it('5 beers, 2 mine and 3 Anna\'s: the shares follow the units, and the detail says how many each took', async () => {
    const { sam, anna, receipt } = await setup();
    const res = await call(sam, 'POST', '/v1/me/splits', {
      receiptId: receipt.receiptId,
      mode: 'items',
      participants: [{ userId: anna.userId }],
      assignments: [
        { lineNo: 1, who: ['me', 'p0'], units: [{ who: 'me', qty: 2 }, { who: 'p0', qty: 3 }] },
        { lineNo: 2, who: ['me'] },
      ],
    });
    expect(res.status).toBe(201);
    const d = res.body as { totalMinor: number; shares: Array<{ isMe: boolean; amountMinor: number; lineNos: number[]; lineUnits: Array<{ lineNo: number; qty: number }> }> };
    const mine = d.shares.find((s) => s.isMe)!;
    const hers = d.shares.find((s) => !s.isMe)!;
    expect(mine.amountMinor).toBe(700 + 800);
    expect(hers.amountMinor).toBe(1050);
    expect(mine.amountMinor + hers.amountMinor).toBe(d.totalMinor);
    expect(mine.lineUnits).toEqual([{ lineNo: 1, qty: 2 }]);
    expect(hers.lineUnits).toEqual([{ lineNo: 1, qty: 3 }]);
    expect(mine.lineNos).toEqual([1, 2]);

    // Anna sees her own split with the same numbers, read back from storage
    const list = (await call(anna, 'GET', '/v1/me/splits')).body as { splits: Array<{ id: string }> };
    const seen = (await call(anna, 'GET', `/v1/me/splits/${list.splits[0]!.id}`)).body as { shares: Array<{ amountMinor: number; lineUnits: Array<{ lineNo: number; qty: number }> }> };
    expect(seen.shares.map((s) => s.amountMinor).sort((a, b) => a - b)).toEqual([1050, 1500]);
    expect(seen.shares.flatMap((s) => s.lineUnits).sort((a, b) => a.qty - b.qty)).toEqual([{ lineNo: 1, qty: 2 }, { lineNo: 1, qty: 3 }]);
    // stored as { n, q } in the existing jsonb column: no schema change
    const rows = await sql<{ line_nos: unknown }>(w, 'select line_nos from buyer.split_shares where split_id = $1', [list.splits[0]!.id]);
    expect(JSON.stringify(rows.map((r) => r.line_nos))).toContain('"q":3');
  });

  it('is refused (400) when the units do not add up to the quantity', async () => {
    const { sam, anna, receipt } = await setup();
    const res = await call(sam, 'POST', '/v1/me/splits', {
      receiptId: receipt.receiptId,
      mode: 'items',
      participants: [{ userId: anna.userId }],
      assignments: [
        { lineNo: 1, who: ['me', 'p0'], units: [{ who: 'me', qty: 2 }, { who: 'p0', qty: 2 }] },
        { lineNo: 2, who: ['me'] },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'units_mismatch' });
  });

  it('an equal share of a line still works next to it (no units)', async () => {
    const { sam, anna, receipt } = await setup();
    const res = await call(sam, 'POST', '/v1/me/splits', {
      receiptId: receipt.receiptId,
      mode: 'items',
      participants: [{ userId: anna.userId }],
      assignments: [
        { lineNo: 1, who: ['me', 'p0'] },
        { lineNo: 2, who: ['p0'] },
      ],
    });
    expect(res.status).toBe(201);
    expect((res.body as { shares: Array<{ lineUnits: unknown[] }> }).shares.every((s) => s.lineUnits.length === 0)).toBe(true);
  });
});
