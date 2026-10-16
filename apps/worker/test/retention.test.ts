import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCall, claimRequest, createReceipt, loginUser, sql, type OrgFixture } from '../../../scripts/lib/testkit.ts';
import { retention } from '../src/jobs/retention.ts';
import { corpusEntry, createWorkerWorld, uploadAndExtract, type WorkerWorld } from './helpers.ts';

let ww: WorkerWorld;
beforeAll(async () => {
  ww = await createWorkerWorld({ leadThreshold: 5 });
}, 120_000);
afterAll(async () => {
  await ww.close();
});

const DAY = 86_400_000;
const at = (days: number, base = Date.now()) => new Date(base + days * DAY);
const withNow = (now: Date) => ({ ...ww.ctx, now: () => now });

describe('retention: account deletion', () => {
  it('soft-deleted accounts keep their data for 30 days; then claims, uploads (and S3 objects), sessions, push and consents are gone while merchant receipts remain', async () => {
    const org = ww.w.orgA;
    const who = await loginUser(ww.w);
    const other = await loginUser(ww.w);

    // data of the user: a claim, an upload with an S3 object and a lead row, a push subscription, consents
    const receipt = await createReceipt(ww.w, org, { state: 'paid' });
    expect((await claimRequest(ww.w, who, receipt)).status).toBe(201);
    const keepReceipt = await createReceipt(ww.w, org, { state: 'paid' });
    expect((await claimRequest(ww.w, other, keepReceipt)).status).toBe(201);
    const up = await uploadAndExtract(ww, who, corpusEntry(ww, 'mock-weegschaal'));
    await uploadAndExtract(ww, other, corpusEntry(ww, 'mock-weegschaal'));
    const key = `vat:${corpusEntry(ww, 'mock-weegschaal').truth.merchant.vatNumber}`;
    expect((await sql<{ n: number }>(ww.w, 'select distinct_uploaders n from leads.unknown_merchants where merchant_key = $1', [key]))[0]?.n).toBe(2);
    expect((await buyerCall(ww.w, 'POST', '/v1/me/push-subscriptions', { token: who.token, body: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } } })).status).toBe(201);
    expect((await buyerCall(ww.w, 'PUT', '/v1/me/consents', { token: who.token, body: { analytics: true } })).status).toBe(200);
    expect(await ww.s3.head(up.key)).not.toBeNull();

    // delete: 204, every session dies immediately, sign-in is refused
    expect((await buyerCall(ww.w, 'DELETE', '/v1/me', { token: who.token })).status).toBe(204);
    expect((await buyerCall(ww.w, 'GET', '/v1/me/receipts', { token: who.token })).status).toBe(401);
    expect((await sql(ww.w, 'select 1 from buyer.sessions where user_id = $1', [who.userId]))).toHaveLength(0);
    expect((await sql(ww.w, 'select 1 from buyer.push_subscriptions where user_id = $1', [who.userId]))).toHaveLength(0);
    await buyerCall(ww.w, 'POST', '/v1/auth/email/start', { body: { email: who.email } });
    expect((await buyerCall(ww.w, 'POST', '/v1/auth/email/verify', { body: { email: who.email, code: ww.w.codes[who.email] } })).status).toBe(401);
    // soft-deleted: still in the database, flagged
    expect((await sql<{ deleted: boolean }>(ww.w, 'select deleted_at is not null as deleted from buyer.users where id = $1', [who.userId]))[0]?.deleted).toBe(true);
    // the audit entry records the deletion without the user id
    const audit = await sql<{ row: string }>(ww.w, "select row_to_json(a)::text row from ops.audit_log a where event = 'account_deleted'");
    expect(audit.length).toBeGreaterThan(0);
    for (const a of audit) expect(a.row).not.toContain(who.userId);

    // day 29: nothing is hard-deleted yet
    const early = await retention(withNow(at(29)));
    expect(early.buyersDeleted).toBe(0);
    expect(await sql(ww.w, 'select 1 from buyer.claims where user_id = $1', [who.userId])).toHaveLength(1);
    expect(await ww.s3.head(up.key)).not.toBeNull();

    // day 31: hard delete
    const out = await retention(withNow(at(31)));
    expect(out.buyersDeleted).toBe(1);
    expect(out.s3ObjectsDeleted).toBe(1);
    expect(await sql(ww.w, 'select 1 from buyer.users where id = $1', [who.userId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from buyer.claims where user_id = $1', [who.userId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from buyer.uploads where user_id = $1', [who.userId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from buyer.consents where user_id = $1', [who.userId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from buyer.email_codes where email = $1', [who.email])).toHaveLength(0);
    expect(await ww.s3.head(up.key)).toBeNull();
    // the lead keeps counting the remaining uploader only
    expect((await sql<{ n: number }>(ww.w, 'select distinct_uploaders n from leads.unknown_merchants where merchant_key = $1', [key]))[0]?.n).toBe(1);
    expect(await sql(ww.w, 'select 1 from leads.unknown_merchant_uploaders where user_id = $1', [who.userId])).toHaveLength(0);

    // the merchant's receipt is untouched: it belongs to the merchant, with all its versions
    expect(await sql(ww.w, 'select 1 from merchant.receipts where id = $1', [receipt.receiptId])).toHaveLength(1);
    expect(await sql(ww.w, 'select 1 from merchant.receipt_versions where receipt_id = $1', [receipt.receiptId])).toHaveLength(1);
    // other users are untouched
    expect(await sql(ww.w, 'select 1 from buyer.claims where user_id = $1', [other.userId])).toHaveLength(1);
    expect(await sql(ww.w, 'select 1 from buyer.users where id = $1', [other.userId])).toHaveLength(1);
    // a second run has nothing left to do
    expect((await retention(withNow(at(31)))).buyersDeleted).toBe(0);
  });
});

describe('retention: merchant receipts', () => {
  it('deletes receipts older than the organisation retention_years (with versions, lines, claims and idempotency keys); newer ones and other orgs stay', async () => {
    const short: OrgFixture = await (async () => {
      const base = await ww.w.addOrg();
      await sql(ww.w, 'update merchant.organizations set retention_years = 1 where id = $1', [base.orgId]);
      return base;
    })();
    const long = ww.w.orgB; // default 7 years

    const iso = (yearsAgo: number, extraDays = 0) => new Date(Date.now() - yearsAgo * 365.25 * DAY - extraDays * DAY).toISOString();
    const oldShort = await createReceipt(ww.w, short, { state: 'paid', createdAt: iso(1, 10) });
    const freshShort = await createReceipt(ww.w, short, { state: 'paid', createdAt: iso(0, 100) });
    const midLong = await createReceipt(ww.w, long, { state: 'paid', createdAt: iso(6) });
    const oldLong = await createReceipt(ww.w, long, { state: 'paid', createdAt: iso(7, 20) });
    const claimer = await loginUser(ww.w);
    expect((await claimRequest(ww.w, claimer, oldShort)).status).toBe(201);
    expect((await claimRequest(ww.w, claimer, freshShort)).status).toBe(201);

    const exists = async (id: string) => (await sql(ww.w, 'select 1 from merchant.receipts where id = $1', [id])).length === 1;
    const out = await retention(ww.ctx);
    expect(out.merchantReceiptsDeleted).toBe(2);
    expect(await exists(oldShort.receiptId)).toBe(false);
    expect(await exists(oldLong.receiptId)).toBe(false);
    expect(await exists(freshShort.receiptId)).toBe(true);
    expect(await exists(midLong.receiptId)).toBe(true);
    expect(await sql(ww.w, 'select 1 from merchant.receipt_versions where receipt_id in ($1, $2)', [oldShort.receiptId, oldLong.receiptId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from merchant.receipt_lines where receipt_id in ($1, $2)', [oldShort.receiptId, oldLong.receiptId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from ops.idempotency_keys where receipt_id in ($1, $2)', [oldShort.receiptId, oldLong.receiptId])).toHaveLength(0);
    // the claim on the deleted receipt goes too; the other claim stays
    expect(await sql(ww.w, 'select receipt_id from buyer.claims where user_id = $1', [claimer.userId])).toEqual([{ receipt_id: freshShort.receiptId }]);
  });
});

describe('retention: expiry', () => {
  it('expires email codes and sessions, prunes old resolve_failures and abandoned uploads; keeps fresh rows', async () => {
    const who = await loginUser(ww.w);
    const receipt = await createReceipt(ww.w, ww.w.orgA, { state: 'paid' });
    await sql(ww.w, "insert into ops.resolve_failures (receipt_id, at) values ($1, now() - interval '2 days'), ($1, now() - interval '10 minutes')", [receipt.receiptId]);
    await sql(ww.w, "insert into buyer.email_codes (email, code_hash, expires_at) values ('old@example.test', 'x', now() - interval '1 minute'), ('new@example.test', 'x', now() + interval '5 minutes')");
    await sql(ww.w, "insert into buyer.sessions (token_hash, user_id, expires_at) values ('expired-session', $1, now() - interval '1 day')", [who.userId]);
    const abandoned = await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'image/png', size: 10 } });
    const { uploadId } = abandoned.body as { uploadId: string };
    await sql(ww.w, "update buyer.uploads set created_at = now() - interval '2 days' where id = $1", [uploadId]);
    const fresh = await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'image/png', size: 10 } });

    const out = await retention(ww.ctx);
    expect(out.emailCodesDeleted).toBeGreaterThanOrEqual(1);
    expect(out.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect(out.resolveFailuresDeleted).toBe(1);
    expect(out.abandonedUploadsDeleted).toBe(1);
    expect(await sql(ww.w, "select 1 from buyer.email_codes where email = 'old@example.test'")).toHaveLength(0);
    expect(await sql(ww.w, "select 1 from buyer.email_codes where email = 'new@example.test'")).toHaveLength(1);
    expect(await sql(ww.w, "select 1 from buyer.sessions where token_hash = 'expired-session'")).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from ops.resolve_failures where receipt_id = $1', [receipt.receiptId])).toHaveLength(1);
    expect(await sql(ww.w, 'select 1 from buyer.uploads where id = $1', [uploadId])).toHaveLength(0);
    expect(await sql(ww.w, 'select 1 from buyer.uploads where id = $1', [(fresh.body as { uploadId: string }).uploadId])).toHaveLength(1);
    // the login session of this test user is still valid
    expect((await buyerCall(ww.w, 'GET', '/v1/me/receipts', { token: who.token })).status).toBe(200);
  });
});
