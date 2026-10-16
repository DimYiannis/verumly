import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newReceiptId } from '@lr/crypto';
import { buildCrf, buyerCall, createReceipt, loginUser, sql, submit, type BuyerSession, type NewReceipt, type OrgFixture } from '../../../scripts/lib/testkit.ts';
import { notifyVersion } from '../src/jobs/notify-version.ts';
import { browserSubscription, decryptWebPush, startPushServer, type BrowserSubscription, type PushServer } from './push-server.ts';
import { createWorkerWorld, type WorkerWorld } from './helpers.ts';

let ww: WorkerWorld;
let push: PushServer;
let org: OrgFixture;
const logged: string[] = [];

beforeAll(async () => {
  ww = await createWorkerWorld();
  ww.ctx.log = (event, fields) => logged.push(JSON.stringify({ event, ...fields }));
  push = await startPushServer();
  org = ww.w.orgA;
}, 120_000);
afterAll(async () => {
  await push.close();
  await ww.close();
});
beforeEach(() => {
  push.requests.length = 0;
  for (const k of Object.keys(push.status)) delete push.status[k];
});

async function subscribe(who: BuyerSession, path: string): Promise<{ id: string; browser: BrowserSubscription }> {
  const browser = browserSubscription();
  const res = await buyerCall(ww.w, 'POST', '/v1/me/push-subscriptions', {
    token: who.token,
    body: { endpoint: `${push.baseUrl}${path}`, keys: { p256dh: browser.p256dh, auth: browser.auth } },
  });
  expect(res.status).toBe(201);
  return { id: (res.body as { id: string }).id, browser };
}

/** A claimed presented receipt (v1) and helpers to add v2/v3 through the real merchant API. */
async function claimedReceipt(who: BuyerSession): Promise<{ r: NewReceipt; addVersion(v: number, state: 'presented' | 'paid', extraItem?: boolean): Promise<void> }> {
  const r = await createReceipt(ww.w, org, { state: 'presented' });
  expect((await buyerCall(ww.w, 'POST', '/v1/me/claims', { token: who.token, body: { receiptId: r.receiptId, secret: r.secret } })).status).toBe(201);
  return {
    r,
    async addVersion(v, state, extraItem = true) {
      const lines = extraItem ? [{ description: 'Koffie', qty: '2', unitPrice: 340, vatRate: 9 as const }, { description: 'Bier', unitPrice: 389, vatRate: 21 as const }] : undefined;
      const res = await submit(ww.w.merchant, org, buildCrf({ receiptId: r.receiptId, version: v, state, org, lines }));
      expect(res.status).toBe(201);
    },
  };
}

describe('notify-version', () => {
  it('pushes exactly once per new version, encrypted (aes128gcm); the text says final when paid; the payload decrypts with the browser key', async () => {
    const who = await loginUser(ww.w);
    const sub = await subscribe(who, '/sub-a');
    const { r, addVersion } = await claimedReceipt(who);

    await addVersion(2, 'presented');
    const v2 = await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 2, state: 'presented' });
    expect(v2).toMatchObject({ sent: 1, removed: 0, failed: 0 });
    expect(push.requests).toHaveLength(1);

    await addVersion(3, 'paid');
    await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 3, state: 'paid' });
    expect(push.requests).toHaveLength(2);

    const [first, second] = push.requests;
    for (const req of [first!, second!]) {
      expect(req.path).toBe('/sub-a');
      expect(req.headers['content-encoding']).toBe('aes128gcm');
      expect(req.headers['content-type']).toBe('application/octet-stream');
      expect(String(req.headers.authorization)).toMatch(/^vapid t=.+, k=.+$/);
      expect(String(req.headers.authorization)).toContain(ww.vapid.publicKey);
      expect(req.headers.ttl).toBeDefined();
      expect(req.body.length).toBeGreaterThan(21 + 65 + 16);
      // nothing readable on the wire
      const wire = req.body.toString('latin1');
      for (const word of ['Café', 'Het Plein', 'Koffie', 'definitief', 'receiptId', r.receiptId]) expect(wire).not.toContain(word);
    }
    // each version has its own Topic, so a retried job cannot show twice
    expect(first!.headers.topic).not.toEqual(second!.headers.topic);

    const p2 = JSON.parse(decryptWebPush(sub.browser, first!.body));
    const p3 = JSON.parse(decryptWebPush(sub.browser, second!.body));
    expect(p2).toEqual({ title: 'Bon bijgewerkt', body: 'Café Het Plein: je bon is bijgewerkt (nog niet definitief).', receiptId: r.receiptId, version: 2, final: false });
    expect(p3).toEqual({ title: 'Bon definitief', body: 'Café Het Plein: je bon is betaald en definitief.', receiptId: r.receiptId, version: 3, final: true });
    // the payload carries no amounts or lines
    expect(JSON.stringify(p3)).not.toMatch(/\d,\d\d|€/);
  });

  it('does nothing for an unclaimed receipt, and for an unknown one', async () => {
    const r = await createReceipt(ww.w, org, { state: 'presented' });
    expect(await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 2, state: 'paid' })).toMatchObject({ sent: 0, skipped: 'no_claim' });
    expect(await notifyVersion(ww.ctx, { receiptId: newReceiptId(), version: 2, state: 'paid' })).toMatchObject({ sent: 0, skipped: 'no_claim' });
    expect(push.requests).toHaveLength(0);
  });

  it('only the owner is notified: another user subscription gets nothing', async () => {
    const owner = await loginUser(ww.w);
    const stranger = await loginUser(ww.w);
    await subscribe(owner, '/owner');
    await subscribe(stranger, '/stranger');
    const { r, addVersion } = await claimedReceipt(owner);
    await addVersion(2, 'paid');
    await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 2, state: 'paid' });
    expect(push.requests.map((q) => q.path)).toEqual(['/owner']);
  });

  it('every subscription of the owner receives it; a 410 deletes only that subscription', async () => {
    const who = await loginUser(ww.w);
    const gone = await subscribe(who, '/gone');
    const alive = await subscribe(who, '/alive');
    const { r, addVersion } = await claimedReceipt(who);
    await addVersion(2, 'paid');
    push.status['/gone'] = 410;
    const out = await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 2, state: 'paid' });
    expect(out).toMatchObject({ sent: 1, removed: 1, failed: 0 });
    expect(push.requests.map((q) => q.path).sort()).toEqual(['/alive', '/gone']);
    const left = await sql<{ id: string }>(ww.w, 'select id from buyer.push_subscriptions where user_id = $1', [who.userId]);
    expect(left).toEqual([{ id: alive.id }]);
    expect(left.some((l) => l.id === gone.id)).toBe(false);
  });

  it('a 404 also deletes the subscription', async () => {
    const who = await loginUser(ww.w);
    await subscribe(who, '/missing');
    const { r, addVersion } = await claimedReceipt(who);
    await addVersion(2, 'paid');
    push.status['/missing'] = 404;
    expect(await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 2, state: 'paid' })).toMatchObject({ removed: 1 });
    expect(await sql(ww.w, 'select 1 from buyer.push_subscriptions where user_id = $1', [who.userId])).toHaveLength(0);
  });

  it('a push service error (5xx) keeps the subscription and fails the job so pg-boss retries', async () => {
    const who = await loginUser(ww.w);
    await subscribe(who, '/flaky');
    const { r, addVersion } = await claimedReceipt(who);
    await addVersion(2, 'paid');
    push.status['/flaky'] = 503;
    await expect(notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 2, state: 'paid' })).rejects.toThrow(/push failed/);
    expect(await sql(ww.w, 'select 1 from buyer.push_subscriptions where user_id = $1', [who.userId])).toHaveLength(1);
  });

  it('a voided receipt says so; a deleted account gets nothing; no VAPID keys means skipped', async () => {
    const who = await loginUser(ww.w);
    const sub = await subscribe(who, '/void');
    const { r, addVersion } = await claimedReceipt(who);
    await addVersion(2, 'paid');
    const voidRes = await submit(ww.w.merchant, org, { ...buildCrf({ receiptId: r.receiptId, version: 3, state: 'void', org, voidOf: r.receiptId }) });
    expect(voidRes.status).toBe(201);
    await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 3, state: 'void' });
    expect(JSON.parse(decryptWebPush(sub.browser, push.requests[0]!.body))).toMatchObject({ title: 'Bon vervallen', version: 3, final: true });

    push.requests.length = 0;
    const saved = ww.ctx.vapid;
    ww.ctx.vapid = null;
    expect(await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 3, state: 'void' })).toMatchObject({ skipped: 'no_vapid' });
    ww.ctx.vapid = saved;
    expect(push.requests).toHaveLength(0);

    expect((await buyerCall(ww.w, 'DELETE', '/v1/me', { token: who.token })).status).toBe(204);
    expect(await notifyVersion(ww.ctx, { receiptId: r.receiptId, version: 3, state: 'void' })).toMatchObject({ sent: 0 });
    expect(push.requests).toHaveLength(0);
  });

  it('logs ids and counts only: never endpoints, keys or payload text', async () => {
    const text = logged.join('\n');
    expect(text).toContain('notify_version');
    for (const secret of [push.baseUrl, 'Café', 'definitief', ww.vapid.privateKey, 'p256dh', 'auth']) expect(text).not.toContain(secret);
  });
});
