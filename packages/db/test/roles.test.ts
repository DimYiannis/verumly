import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDbUrl, type DbRole } from '@lr/config';
import { connect, type DbHandle } from '../src/index.ts';
import { createTestDb, type TestDb } from '../src/testing.ts';
import { attempt, seedBuyerSide, seedOrg, type SeededOrg } from './support.ts';

let testDb: TestDb;
let admin: pg.Pool;
let a: SeededOrg;
let b: SeededOrg;
let buyerUserId: string;
const handles: Partial<Record<DbRole, DbHandle>> = {};
const pool = (role: DbRole): pg.Pool => {
  const h = handles[role];
  if (!h) throw new Error(`no pool for ${role}`);
  return h.pool;
};

beforeAll(async () => {
  testDb = await createTestDb('roles');
  admin = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 4 });
  a = await seedOrg(admin, 1);
  b = await seedOrg(admin, 2);
  buyerUserId = (await seedBuyerSide(admin, a.receiptId)).userId;
  for (const role of ['merchant_api', 'buyer_api', 'worker', 'dashboard'] as const) handles[role] = connect(role, testDb.env, { max: 3 });
}, 120_000);

afterAll(async () => {
  for (const h of Object.values(handles)) await h.close();
  await admin.end();
  await testDb.drop();
});

const DENIED = { ok: false, code: '42501', message: expect.stringMatching(/permission denied/) };
const RLS = { ok: false, code: '42501', message: expect.stringMatching(/row-level security/) };

async function tablesIn(schemas: string[]): Promise<string[]> {
  const r = await admin.query<{ t: string }>(
    "select table_schema || '.' || table_name as t from information_schema.tables where table_schema = any($1) and table_type = 'BASE TABLE' order by 1",
    [schemas],
  );
  return r.rows.map((x) => x.t);
}

describe('buyer and leads are unreachable for merchant_api and dashboard (v2 §16.E)', () => {
  it('the tables under test are the real ones (guards against a new table escaping the loop)', async () => {
    expect(await tablesIn(['buyer', 'leads'])).toEqual([
      'buyer.claims',
      'buyer.consents',
      'buyer.email_codes',
      'buyer.push_subscriptions',
      'buyer.sessions',
      'buyer.uploads',
      'buyer.users',
      'leads.unknown_merchant_uploaders',
      'leads.unknown_merchants',
    ]);
  });

  it('positive control: the same tables ARE readable by buyer_api, and hold rows (so a denial is meaningful)', async () => {
    for (const t of await tablesIn(['buyer', 'leads'])) {
      const r = await attempt(pool('buyer_api'), `select count(*)::int n from ${t}`);
      expect(r, t).toMatchObject({ ok: true });
      if (r.ok) expect(r.rows[0]?.n, `${t} has a seeded row`).toBeGreaterThan(0);
    }
  });

  it.each(['merchant_api', 'dashboard'] as const)('%s: SELECT, INSERT, UPDATE, DELETE and TRUNCATE on every buyer.* and leads.* table → permission denied', async (role) => {
    for (const t of await tablesIn(['buyer', 'leads'])) {
      for (const [kind, text] of [
        ['select *', `select * from ${t}`],
        ['select count', `select count(*) from ${t}`],
        ['insert', `insert into ${t} default values`],
        ['update', `update ${t} set ${t.startsWith('leads') ? 'merchant_key' : t.endsWith('claims') ? 'source' : 'user_id'} = null where false`],
        ['delete', `delete from ${t} where false`],
        ['truncate', `truncate ${t}`],
      ] as const) {
        expect(await attempt(pool(role), text, { orgId: a.orgId }), `${role}: ${kind} ${t}`).toMatchObject(DENIED);
      }
    }
  });

  it.each(['merchant_api', 'dashboard'] as const)('%s: cannot even resolve the buyer schema (no USAGE), or read it through the catalog helpers', async (role) => {
    expect(await attempt(pool(role), 'select * from buyer.claims')).toMatchObject({ ok: false, message: 'permission denied for schema buyer' });
    expect(await attempt(pool(role), 'select * from leads.unknown_merchants')).toMatchObject({ ok: false, message: 'permission denied for schema leads' });
    const priv = await attempt(pool(role), "select has_schema_privilege('buyer', 'USAGE') as buyer, has_schema_privilege('leads', 'USAGE') as leads");
    expect(priv).toMatchObject({ ok: true, rows: [{ buyer: false, leads: false }] });
  });

  it('the person ↔ receipt link exists only in buyer.claims: nothing in the merchant schema references a user, and no FK crosses into buyer/leads', async () => {
    const fks = await admin.query(
      `select conrelid::regclass::text as from_table, confrelid::regclass::text as to_table from pg_constraint
       where contype = 'f' and connamespace::regnamespace::text = 'merchant' and confrelid::regclass::text !~ '^(merchant\\.)?[a-z_]+$'`,
    );
    expect(fks.rows).toEqual([]);
    const crossing = await admin.query(
      `select conrelid::regclass::text as t from pg_constraint c join pg_class r on r.oid = c.confrelid
       where c.contype = 'f' and c.connamespace::regnamespace::text = 'merchant' and r.relnamespace::regnamespace::text in ('buyer','leads','ops')`,
    );
    expect(crossing.rows).toEqual([]);
  });

  it('no merchant column can hold a buyer identifier (only the merchant users’ own e-mail and session user id exist)', async () => {
    const r = await admin.query<{ c: string }>(
      `select table_name || '.' || column_name as c from information_schema.columns
       where table_schema = 'merchant' and column_name ~* '(email|phone|user|buyer|customer|loyalty|pan|card|person|claimer|owner)' order by 1`,
    );
    expect(r.rows.map((x) => x.c)).toEqual(['dashboard_sessions.user_id', 'merchant_users.email']);
  });

  it('ops.audit_log holds no user id or buyer e-mail even after claims (receipt id only)', async () => {
    await admin.query("insert into ops.audit_log (event, receipt_id) values ('claim', $1)", [a.receiptId]);
    const r = await admin.query<{ t: string }>('select row_to_json(l)::text t from ops.audit_log l');
    for (const row of r.rows) {
      expect(row.t).not.toContain(buyerUserId);
      expect(row.t).not.toContain('buyer@example.test');
    }
  });
});

describe('row-level security: org A cannot see or touch org B', () => {
  const tableRoles: Array<{ role: 'merchant_api' | 'dashboard'; tables: string[] }> = [
    { role: 'merchant_api', tables: ['organizations', 'locations', 'terminals', 'receipts', 'receipt_versions', 'receipt_lines'] },
    {
      role: 'dashboard',
      tables: ['organizations', 'locations', 'terminals', 'merchant_users', 'dashboard_sessions', 'receipts', 'receipt_versions', 'receipt_lines', 'daily_rollups', 'exports'],
    },
  ];
  const orgColumn = (t: string) => (t === 'organizations' ? 'id' : 'org_id');

  for (const { role, tables } of tableRoles) {
    describe(role, () => {
      it.each(tables)('%s: sees exactly its own organisation’s rows', async (t) => {
        const own = await attempt(pool(role), `select ${orgColumn(t)} as org from merchant.${t}`, { orgId: a.orgId });
        expect(own).toMatchObject({ ok: true, rows: [{ org: a.orgId }] });
        const other = await attempt(pool(role), `select ${orgColumn(t)} as org from merchant.${t}`, { orgId: b.orgId });
        expect(other).toMatchObject({ ok: true, rows: [{ org: b.orgId }] });
        // asking for the other org's rows by key finds nothing
        const probe = await attempt(pool(role), `select 1 from merchant.${t} where ${orgColumn(t)} = $1`, { orgId: a.orgId, params: [b.orgId] });
        expect(probe).toMatchObject({ ok: true, rowCount: 0 });
      });

      it.each(tables)('%s: with no org set, or an unknown org, it sees nothing (fails closed)', async (t) => {
        expect(await attempt(pool(role), `select 1 from merchant.${t}`)).toMatchObject({ ok: true, rowCount: 0 });
        expect(await attempt(pool(role), `select 1 from merchant.${t}`, { orgId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ ok: true, rowCount: 0 });
        expect(await attempt(pool(role), `select 1 from merchant.${t}`, { orgId: '' })).toMatchObject({ ok: true, rowCount: 0 });
      });

      it('a malformed org id errors instead of matching rows', async () => {
        const r = await attempt(pool(role), 'select 1 from merchant.receipts', { orgId: 'not-a-uuid' });
        expect(r).toMatchObject({ ok: false, code: '22P02' });
      });

      it('joins cannot smuggle B’s rows in either (receipts ⋈ versions ⋈ lines for org A only)', async () => {
        const r = await attempt(
          pool(role),
          `select r.org_id from merchant.receipts r join merchant.receipt_versions v on v.receipt_id = r.id join merchant.receipt_lines l on l.receipt_id = r.id`,
          { orgId: a.orgId },
        );
        expect(r).toMatchObject({ ok: true, rows: [{ org_id: a.orgId }] });
      });
    });
  }

  it('merchant_api cannot INSERT a receipt, version or line for another organisation', async () => {
    const rid = '01a14600-0000-7000-8000-000000000001';
    const receipt = await attempt(
      pool('merchant_api'),
      `insert into merchant.receipts (id, org_id, location_id, terminal_id, state, current_version, claim_secret_hash, total_minor, created_on_terminal_at, claimable_until)
       values ($1, $2, $3, $4, 'presented', 1, 'h', 1, now(), now())`,
      { orgId: a.orgId, params: [rid, b.orgId, b.locationId, b.terminalId] },
    );
    expect(receipt).toMatchObject(RLS);
    expect(await attempt(pool('merchant_api'), "insert into merchant.receipt_versions (receipt_id, org_id, version, state, payload, signature, created_on_terminal_at) values ($1, $2, 9, 'paid', '{}'::jsonb, 's', now())", { orgId: a.orgId, params: [b.receiptId, b.orgId] })).toMatchObject(RLS);
    expect(await attempt(pool('merchant_api'), "insert into merchant.receipt_lines (receipt_id, org_id, line_no, kind, description, qty, unit_price_minor, total_minor) values ($1, $2, 9, 'item', 'x', '1', 1, 1)", { orgId: a.orgId, params: [b.receiptId, b.orgId] })).toMatchObject(RLS);
    // positive control: the same insert for its own org passes RLS (and then fails on a later constraint, not on policy)
    const own = await attempt(pool('merchant_api'), "insert into merchant.receipt_versions (receipt_id, org_id, version, state, payload, signature, created_on_terminal_at) values ($1, $2, 2, 'paid', '{}'::jsonb, 's', now())", { orgId: a.orgId, params: [a.receiptId, a.orgId] });
    expect(own).toMatchObject({ ok: true, rowCount: 1 });
  });

  it('dashboard cannot INSERT or move rows into another organisation', async () => {
    const asA = { orgId: a.orgId };
    expect(await attempt(pool('dashboard'), 'insert into merchant.locations (org_id, name) values ($1, $2)', { ...asA, params: [b.orgId, 'planted'] })).toMatchObject(RLS);
    expect(await attempt(pool('dashboard'), "insert into merchant.merchant_users (org_id, email, password_hash, role) values ($1, 'x@x.test', 'h', 'owner')", { ...asA, params: [b.orgId] })).toMatchObject(RLS);
    expect(await attempt(pool('dashboard'), "insert into merchant.exports (org_id, kind, period_from, period_to) values ($1, 'csv', current_date, current_date)", { ...asA, params: [b.orgId] })).toMatchObject(RLS);
    // moving one of A's rows into B is an UPDATE whose NEW row violates the policy
    expect(await attempt(pool('dashboard'), 'update merchant.locations set org_id = $1 where id = $2', { ...asA, params: [b.orgId, a.locationId] })).toMatchObject(RLS);
    // positive control: inserting into its own org works
    expect(await attempt(pool('dashboard'), 'insert into merchant.locations (org_id, name) values ($1, $2)', { ...asA, params: [a.orgId, 'mine'] })).toMatchObject({ ok: true, rowCount: 1 });
  });

  it.each(['merchant_api', 'dashboard'] as const)('%s: UPDATE and DELETE aimed at another organisation touch zero rows', async (role) => {
    const asA = { orgId: a.orgId };
    expect(await attempt(pool(role), "update merchant.receipts set state = 'void' where id = $1", { ...asA, params: [b.receiptId] })).toMatchObject(
      role === 'merchant_api' ? { ok: true, rowCount: 0 } : { ok: false, code: '42501' }, // dashboard has no UPDATE on receipts at all
    );
    if (role === 'dashboard') {
      expect(await attempt(pool(role), "update merchant.organizations set legal_name = 'pwned' where id = $1", { ...asA, params: [b.orgId] })).toMatchObject({ ok: true, rowCount: 0 });
      expect(await attempt(pool(role), 'delete from merchant.locations where org_id = $1', { ...asA, params: [b.orgId] })).toMatchObject({ ok: true, rowCount: 0 });
      expect(await attempt(pool(role), "update merchant.organizations set legal_name = 'ok' where id = $1", { ...asA, params: [a.orgId] })).toMatchObject({ ok: true, rowCount: 1 });
    }
    const intact = await admin.query('select legal_name from merchant.organizations where id = $1', [b.orgId]);
    expect(intact.rows[0]?.legal_name).toBe('Org 2');
  });

  it('documented limit: RLS trusts `app.org_id`, which the connection itself can set — it protects against bugs, not against a compromised service', async () => {
    const client = await pool('merchant_api').connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [a.orgId]);
      expect((await client.query('select count(*)::int n from merchant.receipts where org_id = $1', [b.orgId])).rows[0]?.n).toBe(0);
      await client.query("select set_config('app.org_id', $1, true)", [b.orgId]); // the service flips its own context
      expect((await client.query('select count(*)::int n from merchant.receipts where org_id = $1', [b.orgId])).rows[0]?.n).toBe(1);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

describe('column and table grants: terminals, merchant_users and key material', () => {
  it.each(['buyer_api', 'worker'] as const)('%s: no access at all to terminals, merchant_users or dashboard_sessions (key, password and TOTP columns unreachable)', async (role) => {
    for (const text of [
      'select api_key_hash from merchant.terminals',
      'select signing_public_key from merchant.terminals',
      'select id from merchant.terminals',
      'select * from merchant.terminals',
      'select password_hash from merchant.merchant_users',
      'select totp_secret_encrypted from merchant.merchant_users',
      'select email from merchant.merchant_users',
      'select * from merchant.merchant_users',
      'select token_hash from merchant.dashboard_sessions',
      'select count(*) from merchant.terminals',
    ]) {
      expect(await attempt(pool(role), text), `${role}: ${text}`).toMatchObject(DENIED);
    }
  });

  it.each(['buyer_api', 'worker'] as const)('%s: organisations and locations expose only the whitelisted columns', async (role) => {
    const ok = await attempt(pool(role), 'select id, legal_name, kvk_number, vat_number, country from merchant.organizations order by kvk_number');
    expect(ok).toMatchObject({ ok: true, rowCount: 2 });
    for (const col of ['plan', 'created_at']) expect(await attempt(pool(role), `select ${col} from merchant.organizations`), col).toMatchObject(DENIED);
    expect(await attempt(pool(role), 'select * from merchant.organizations')).toMatchObject(DENIED);
    expect(await attempt(pool(role), 'select id, org_id, name, address, postcode from merchant.locations')).toMatchObject({ ok: true, rowCount: 2 });
    for (const col of ['lat', 'lng', 'timezone']) expect(await attempt(pool(role), `select ${col} from merchant.locations`), col).toMatchObject(DENIED);
  });

  it.each(['merchant_api', 'dashboard'] as const)('%s: cannot read buyer-side secrets by calling someone else’s SECURITY DEFINER lookups', async (role) => {
    const fn = {
      merchant_api: ['merchant.find_user_for_login($1)', 'merchant.find_dashboard_session($1)'],
      dashboard: ['merchant.authenticate_terminal($1)'],
    }[role];
    for (const f of fn) expect(await attempt(pool(role), `select * from ${f}`, { params: ['x'] }), `${role}: ${f}`).toMatchObject(DENIED);
  });

  it.each(['buyer_api', 'worker'] as const)('%s cannot call any of the merchant-side lookup functions', async (role) => {
    for (const f of ['merchant.authenticate_terminal($1)', 'merchant.find_user_for_login($1)', 'merchant.find_dashboard_session($1)']) {
      expect(await attempt(pool(role), `select * from ${f}`, { params: ['x'] }), `${role}: ${f}`).toMatchObject(DENIED);
    }
  });

  it('buyer_api reads the merchant receipt tables read-only (it can verify secrets; it cannot write receipts)', async () => {
    const r = await attempt(pool('buyer_api'), 'select id, claim_secret_hash from merchant.receipts order by id');
    expect(r).toMatchObject({ ok: true, rowCount: 2 }); // by design: the resolver must see every organisation's receipts
    for (const text of [
      "insert into merchant.receipts (id, org_id, location_id, terminal_id, state, current_version, claim_secret_hash, total_minor, created_on_terminal_at, claimable_until) select gen_random_uuid(), org_id, location_id, terminal_id, state, 1, 'h', 1, now(), now() from merchant.receipts",
      "update merchant.receipts set state = 'void'",
      'delete from merchant.receipts',
      "update merchant.receipt_versions set signature = 'x'",
      'delete from merchant.receipt_versions',
      "update merchant.organizations set legal_name = 'x'",
    ]) {
      expect(await attempt(pool('buyer_api'), text), text).toMatchObject(DENIED);
    }
  });

  it('merchant_api cannot create objects or reach the public schema', async () => {
    for (const role of ['merchant_api', 'dashboard', 'buyer_api', 'worker'] as const) {
      expect(await attempt(pool(role), 'create table public.sneaky (x int)'), role).toMatchObject(DENIED);
      expect(await attempt(pool(role), 'create table merchant.sneaky (x int)'), role).toMatchObject(DENIED);
      expect(await attempt(pool(role), 'create schema sneaky'), role).toMatchObject({ ok: false, code: '42501' });
    }
  });
});

describe('ops: the audit log is append-only and per-role', () => {
  it.each(['merchant_api', 'buyer_api', 'worker', 'dashboard'] as const)('%s can INSERT into ops.audit_log but never SELECT, UPDATE, DELETE or TRUNCATE it', async (role) => {
    expect(await attempt(pool(role), "insert into ops.audit_log (event) values ('probe')")).toMatchObject({ ok: true, rowCount: 1 });
    for (const text of ['select * from ops.audit_log', 'select count(*) from ops.audit_log', "update ops.audit_log set event = 'x'", 'delete from ops.audit_log', 'truncate ops.audit_log']) {
      expect(await attempt(pool(role), text), `${role}: ${text}`).toMatchObject(DENIED);
    }
  });

  it('idempotency keys are merchant_api’s; resolve_failures are buyer-side only', async () => {
    expect(await attempt(pool('merchant_api'), 'select count(*) from ops.idempotency_keys')).toMatchObject({ ok: true });
    expect(await attempt(pool('dashboard'), 'select count(*) from ops.idempotency_keys')).toMatchObject(DENIED);
    expect(await attempt(pool('buyer_api'), 'select count(*) from ops.idempotency_keys')).toMatchObject(DENIED);
    expect(await attempt(pool('merchant_api'), 'select count(*) from ops.resolve_failures')).toMatchObject(DENIED);
    expect(await attempt(pool('dashboard'), 'select count(*) from ops.resolve_failures')).toMatchObject(DENIED);
    expect(await attempt(pool('buyer_api'), 'select count(*) from ops.resolve_failures')).toMatchObject({ ok: true });
  });

  it('buyer.consents is append-only for buyer_api and worker (no UPDATE or DELETE)', async () => {
    for (const role of ['buyer_api', 'worker'] as const) {
      expect(await attempt(pool(role), "insert into buyer.consents (user_id, purpose, granted, policy_version) values ($1, 'x', true, '1')", { params: [buyerUserId] })).toMatchObject({ ok: true });
      expect(await attempt(pool(role), 'update buyer.consents set granted = false')).toMatchObject(DENIED);
      expect(await attempt(pool(role), 'delete from buyer.consents')).toMatchObject(DENIED);
    }
  });
});
