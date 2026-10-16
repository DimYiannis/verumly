import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, newReceiptId } from '@lr/crypto';
import {
  buildCrf,
  buyerCall,
  claimRequest,
  createReceipt,
  createWorld,
  loginUser,
  resolveRequest,
  sql,
  submit,
  type NewReceipt,
  type World,
} from '../../../scripts/lib/testkit.ts';

describe('resolve: pending, ok, wrong secret, open receipts', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld({ resolveRatePerMinute: 1000 });
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  it.each(['secret', 'view'] as const)('/%s: a receipt that was never uploaded is pending (the offline-first path)', async (kind) => {
    const res = await resolveRequest(w, { receiptId: newReceiptId(), secret: generateSecret() }, kind);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'pending' });
  });

  it('pending before upload, ok after: the same request flips once the terminal has uploaded', async () => {
    const receiptId = newReceiptId();
    const secret = generateSecret();
    const ask = () => resolveRequest(w, { receiptId, secret });
    expect((await ask()).body).toEqual({ status: 'pending' });
    await submit(w.merchant, w.orgA, buildCrf({ receiptId, version: 1, state: 'presented', org: w.orgA }), { secret });
    const after = await ask();
    expect(after.status).toBe(200);
    expect(after.body).toEqual({
      status: 'ok',
      preview: {
        merchantName: 'Café Het Plein',
        locationName: expect.stringContaining('Location'),
        total: 680,
        currency: 'EUR',
        createdAt: expect.any(String),
        state: 'presented',
        claimed: false,
      },
    });
  });

  it('/view returns the full receipt, version history and the final flag (presented: not final; paid: final in NL)', async () => {
    const r = await createReceipt(w, w.orgA);
    const presented = await resolveRequest(w, r, 'view');
    expect(presented.body).toMatchObject({ status: 'ok', final: false, receipt: { version: 1, state: 'presented' }, versions: [{ version: 1, state: 'presented' }] });
    await submit(w.merchant, w.orgA, buildCrf({ receiptId: r.receiptId, version: 2, state: 'paid', org: w.orgA }));
    const paid = await resolveRequest(w, r, 'view');
    expect(paid.body).toMatchObject({ status: 'ok', final: true, receipt: { version: 2, state: 'paid' }, versions: [{ version: 1 }, { version: 2 }] });
  });

  it('a wrong secret on an existing receipt → 404 not_found on both routes', async () => {
    const r = await createReceipt(w, w.orgA);
    for (const kind of ['secret', 'view'] as const) {
      const res = await resolveRequest(w, { receiptId: r.receiptId, secret: generateSecret() }, kind);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'not_found' });
    }
  });

  it('a malformed secret or id is rejected by validation (400), not looked up', async () => {
    const r = await createReceipt(w, w.orgA);
    for (const body of [{ receiptId: r.receiptId, secret: 'short' }, { receiptId: 'not-a-uuid', secret: r.secret }, { receiptId: r.receiptId }]) {
      expect((await buyerCall(w, 'POST', '/v1/resolve/secret', { body })).status).toBe(400);
    }
  });

  it('open receipts are invisible to resolvers: pending with the right secret, pending with a wrong one, no oracle', async () => {
    const open = await createReceipt(w, w.orgA, { state: 'open' });
    for (const kind of ['secret', 'view'] as const) {
      expect((await resolveRequest(w, open, kind)).body).toEqual({ status: 'pending' });
      expect((await resolveRequest(w, { receiptId: open.receiptId, secret: generateSecret() }, kind)).body).toEqual({ status: 'pending' });
    }
    // wrong secrets on an open receipt are not counted as failures
    expect(await sql(w, 'select 1 from ops.resolve_failures where receipt_id = $1', [open.receiptId])).toHaveLength(0);
    // and they cannot be claimed
    const user = await loginUser(w);
    expect((await claimRequest(w, user, open)).status).toBe(404);
    // the first presentation makes it visible
    await submit(w.merchant, w.orgA, buildCrf({ receiptId: open.receiptId, version: 2, state: 'presented', org: w.orgA }));
    expect((await resolveRequest(w, open)).body).toMatchObject({ status: 'ok', preview: { state: 'presented' } });
    expect((await claimRequest(w, user, open)).status).toBe(201);
  });

  it('a receipt that went open → void stays visible only as what it is now (void), never as open content', async () => {
    const open = await createReceipt(w, w.orgA, { state: 'open' });
    await submit(w.merchant, w.orgA, buildCrf({ receiptId: open.receiptId, version: 2, state: 'void', org: w.orgA }));
    const res = await resolveRequest(w, open, 'view');
    expect(res.body).toMatchObject({ status: 'ok', preview: { state: 'void' }, final: true });
  });

  it('the resolver exposes nothing buyer-side: no user id, no email, no claim hash', async () => {
    const r = await createReceipt(w, w.orgA);
    const user = await loginUser(w);
    await claimRequest(w, user, r);
    const res = await resolveRequest(w, r, 'view');
    expect(res.body).toMatchObject({ status: 'ok', preview: { claimed: true } });
    expect(res.text).not.toContain(user.userId);
    expect(res.text).not.toContain(user.email);
    expect(res.text).not.toMatch(/claim_?secret|secretHash/i);
  });
});

describe('resolve: per-IP rate limit (30/min)', () => {
  let w: World;
  let r: NewReceipt;
  beforeAll(async () => {
    w = await createWorld({ resolveRatePerMinute: 5 });
    r = await createReceipt(w, w.orgA);
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  it('the (limit+1)th request from one IP in a minute → 429; another IP is unaffected', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await resolveRequest(w, r, 'secret', '10.0.0.1')).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await resolveRequest(w, r, 'secret', '10.0.0.2')).status).toBe(200);
  });

  it('the limit is per IP across both resolver routes, not per route', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await resolveRequest(w, r, i % 2 ? 'view' : 'secret', '10.0.1.1')).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('a spoofed X-Forwarded-For does not buy a fresh allowance (proxy headers are not trusted)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await buyerCall(w, 'POST', '/v1/resolve/secret', {
        body: { receiptId: r.receiptId, secret: r.secret },
        remoteAddress: '10.0.2.1',
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
      });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('authenticated routes are not subject to the public resolver limit', async () => {
    const user = await loginUser(w);
    for (let i = 0; i < 8; i++) expect((await buyerCall(w, 'GET', '/v1/me/receipts', { token: user.token, remoteAddress: '10.0.3.1' })).status).toBe(200);
  });
});

describe('resolve: per-IP rate limit at the real default', () => {
  let w: World;
  let r: NewReceipt;
  beforeAll(async () => {
    w = await createWorld(); // no resolveRatePerMinute override: the production default
    r = await createReceipt(w, w.orgA);
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  it('30 requests per minute per IP succeed, the 31st is 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await resolveRequest(w, r, 'secret', '10.9.9.9')).status);
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    expect((await resolveRequest(w, r, 'secret', '10.9.9.8')).status).toBe(200);
  });
});

describe('resolve: 10 failed secrets per receipt per hour', () => {
  let w: World;
  beforeAll(async () => {
    w = await createWorld({ resolveRatePerMinute: 10_000 });
  }, 120_000);
  afterAll(async () => {
    await w.close();
  });

  it('attempts 1–10 are 404; the 11th wrong attempt and the CORRECT secret are then both 429, from any IP', async () => {
    const r = await createReceipt(w, w.orgA);
    const other = await createReceipt(w, w.orgA);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await resolveRequest(w, { receiptId: r.receiptId, secret: generateSecret() }, 'secret', `10.1.0.${i}`)).status);
    expect(statuses).toEqual(Array(10).fill(404));

    const wrong = await resolveRequest(w, { receiptId: r.receiptId, secret: generateSecret() }, 'secret', '10.1.1.1');
    expect(wrong.status).toBe(429);
    for (const kind of ['secret', 'view'] as const) {
      const right = await resolveRequest(w, r, kind, '10.1.1.2');
      expect(right.status, `correct secret on /${kind} while limited`).toBe(429);
      expect(right.text).not.toContain('Café');
    }
    // the authenticated claim endpoint is behind the same limit
    const user = await loginUser(w);
    expect((await claimRequest(w, user, r)).status).toBe(429);
    // other receipts are unaffected
    expect((await resolveRequest(w, other, 'secret', '10.1.1.3')).status).toBe(200);
    expect((await claimRequest(w, user, other)).status).toBe(201);
  });

  it('failures on /view count too, and the limit lifts once the failures are older than an hour', async () => {
    const r = await createReceipt(w, w.orgA);
    for (let i = 0; i < 10; i++) await resolveRequest(w, { receiptId: r.receiptId, secret: generateSecret() }, i % 2 ? 'view' : 'secret');
    expect((await resolveRequest(w, r)).status).toBe(429);
    await sql(w, "update ops.resolve_failures set at = now() - interval '61 minutes' where receipt_id = $1", [r.receiptId]);
    const after = await resolveRequest(w, r);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ status: 'ok' });
  });

  it('9 failures are still tolerated: the correct secret works after 9 wrong ones', async () => {
    const r = await createReceipt(w, w.orgA);
    for (let i = 0; i < 9; i++) await resolveRequest(w, { receiptId: r.receiptId, secret: generateSecret() });
    expect((await resolveRequest(w, r)).status).toBe(200);
  });

  it('pending (never uploaded) ids are not counted, so probing unknown ids never locks a real receipt', async () => {
    const id = newReceiptId();
    for (let i = 0; i < 15; i++) expect((await resolveRequest(w, { receiptId: id, secret: generateSecret() })).body).toEqual({ status: 'pending' });
    expect(await sql(w, 'select 1 from ops.resolve_failures where receipt_id = $1', [id])).toHaveLength(0);
  });
});
