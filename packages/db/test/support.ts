import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { newReceiptId } from '@lr/crypto';

export type Outcome = { ok: true; rowCount: number; rows: Array<Record<string, unknown>> } | { ok: false; code: string; message: string };

/**
 * Run one statement as the pool's role inside a transaction that is ALWAYS rolled back, optionally with `app.org_id` set
 * (what merchant-api and the dashboard do per request). Never throws for SQL errors: the error code is the result.
 */
export async function attempt(pool: pg.Pool, text: string, opts: { orgId?: string; params?: unknown[] } = {}): Promise<Outcome> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (opts.orgId !== undefined) await client.query("select set_config('app.org_id', $1, true)", [opts.orgId]);
    const r = await client.query(text, opts.params);
    await client.query('rollback');
    return { ok: true, rowCount: r.rowCount ?? 0, rows: r.rows };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' && e instanceof Error) return { ok: false, code: e.code, message: e.message };
    throw e;
  } finally {
    client.release();
  }
}

export interface SeededOrg {
  orgId: string;
  locationId: string;
  terminalId: string;
  userId: string;
  receiptId: string;
  kvk: string;
  email: string;
}

/** One row in every `merchant` table for an organisation, written as the table owner (bypasses RLS). */
export async function seedOrg(admin: pg.Pool, n: number): Promise<SeededOrg> {
  const kvk = String(70_000_000 + n);
  const one = async (text: string, params: unknown[]): Promise<string> => {
    const r = await admin.query<{ id: string }>(text, params);
    return r.rows[0]!.id;
  };
  const orgId = await one('insert into merchant.organizations (legal_name, kvk_number, vat_number) values ($1, $2, $3) returning id', [`Org ${n}`, kvk, `NL12345678${n}B01`]);
  const locationId = await one('insert into merchant.locations (org_id, name) values ($1, $2) returning id', [orgId, `Loc ${n}`]);
  const terminalId = await one(
    'insert into merchant.terminals (location_id, org_id, label, api_key_hash, signing_public_key) values ($1, $2, $3, $4, $5) returning id',
    [locationId, orgId, `T${n}`, `hash-${n}-${randomUUID()}`, `pub-${n}`],
  );
  const email = `owner${n}@org.test`;
  const userId = await one('insert into merchant.merchant_users (org_id, email, password_hash, totp_secret_encrypted, role) values ($1, $2, $3, $4, $5) returning id', [
    orgId,
    email,
    `argon2-secret-hash-${n}`,
    `totp-secret-${n}`,
    'owner',
  ]);
  await admin.query("insert into merchant.dashboard_sessions (token_hash, user_id, org_id, expires_at) values ($1, $2, $3, now() + interval '1 day')", [`session-${n}-${randomUUID()}`, userId, orgId]);
  const receiptId = newReceiptId();
  await admin.query(
    `insert into merchant.receipts (id, org_id, location_id, terminal_id, state, current_version, claim_secret_hash, total_minor, created_on_terminal_at, claimable_until)
     values ($1, $2, $3, $4, 'presented', 1, $5, 680, now(), now() + interval '90 days')`,
    [receiptId, orgId, locationId, terminalId, `secret-hash-${n}`],
  );
  await admin.query("insert into merchant.receipt_versions (receipt_id, org_id, version, state, payload, signature, created_on_terminal_at) values ($1, $2, 1, 'presented', '{}'::jsonb, 'sig', now())", [receiptId, orgId]);
  await admin.query("insert into merchant.receipt_lines (receipt_id, org_id, line_no, kind, description, qty, unit_price_minor, total_minor) values ($1, $2, 1, 'item', 'Koffie', '2', 340, 680)", [receiptId, orgId]);
  await admin.query("insert into merchant.daily_rollups (location_id, org_id, day) values ($1, $2, current_date)", [locationId, orgId]);
  await admin.query("insert into merchant.exports (org_id, kind, period_from, period_to) values ($1, 'csv', current_date, current_date)", [orgId]);
  // billing: a mandate, the subscription on it, a checkout and a paid invoice
  const mandateId = await one("insert into merchant.billing_mandates (org_id, method, label) values ($1, 'card', 'Card •••• 4242') returning id", [orgId]);
  await admin.query(
    "insert into merchant.subscriptions (org_id, plan, interval, status, current_period_start, current_period_end, mandate_id) values ($1, 'business', 'monthly', 'active', now(), now() + interval '1 month', $2)",
    [orgId, mandateId],
  );
  await admin.query(
    "insert into merchant.payment_sessions (org_id, plan, interval, net_minor, vat_minor, gross_minor, status, created_by, expires_at) values ($1, 'business', 'monthly', 4900, 1029, 5929, 'paid', $2, now() + interval '30 minutes')",
    [orgId, userId],
  );
  await admin.query(
    "insert into merchant.invoices (org_id, number, plan, interval, period_start, period_end, net_minor, vat_minor, gross_minor, status, method_label, paid_at) values ($1, $2, 'business', 'monthly', now(), now() + interval '1 month', 4900, 1029, 5929, 'paid', 'Card •••• 4242', now())",
    [orgId, `LR-2026-${String(n).padStart(6, '0')}`],
  );
  return { orgId, locationId, terminalId, userId, receiptId, kvk, email };
}

/** Rows in the buyer and leads schemas, so "SELECT fails" is not vacuously true on empty tables. */
export async function seedBuyerSide(admin: pg.Pool, receiptId: string): Promise<{ userId: string }> {
  const u = await admin.query<{ id: string }>("insert into buyer.users (email) values ('buyer@example.test') returning id");
  const userId = u.rows[0]!.id;
  await admin.query("insert into buyer.sessions (token_hash, user_id, expires_at) values ('tok', $1, now() + interval '1 day')", [userId]);
  await admin.query("insert into buyer.email_codes (email, code_hash, expires_at) values ('buyer@example.test', 'h', now() + interval '1 hour')");
  await admin.query("insert into buyer.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.test/x', 'k', 'a')", [userId]);
  await admin.query("insert into buyer.claims (receipt_id, user_id, source) values ($1, $2, 'qr')", [receiptId, userId]);
  await admin.query("insert into buyer.uploads (user_id, s3_key, content_type) values ($1, 'k', 'image/png')", [userId]);
  await admin.query("insert into buyer.consents (user_id, purpose, granted, policy_version) values ($1, 'insights', true, '1')", [userId]);
  // friends, shares and splits
  const f = await admin.query<{ id: string }>("insert into buyer.users (email, handle) values ('friend@example.test', 'friend_one') returning id");
  const friendId = f.rows[0]!.id;
  await admin.query("insert into buyer.friendships (requester_id, addressee_id, status) values ($1, $2, 'accepted')", [userId, friendId]);
  const s = await admin.query<{ id: string }>("insert into buyer.splits (receipt_id, creator_id, mode, total_minor) values ($1, $2, 'equal', 680) returning id", [receiptId, userId]);
  const sh = await admin.query<{ id: string }>("insert into buyer.split_shares (split_id, user_id, amount_minor) values ($1, $2, 340) returning id", [s.rows[0]!.id, friendId]);
  await admin.query("insert into buyer.invites (code_hash, inviter_id, split_share_id, expires_at) values ('invitehash', $1, $2, now() + interval '1 day')", [userId, sh.rows[0]!.id]);
  const rs = await admin.query<{ id: string }>("insert into buyer.receipt_shares (receipt_id, from_user_id, to_user_id) values ($1, $2, $3) returning id", [receiptId, userId, friendId]);
  await admin.query("insert into buyer.share_reactions (share_id, user_id, emoji) values ($1, $2, '👍')", [rs.rows[0]!.id, friendId]);
  await admin.query("insert into leads.unknown_merchants (merchant_key) values ('kvk:99999999')");
  await admin.query("insert into leads.unknown_merchant_uploaders (merchant_key, user_id) values ('kvk:99999999', $1)", [userId]);
  return { userId };
}
