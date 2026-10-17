import pg from 'pg';
import { adminDbUrl, dbEnvSchema, DB_ROLES, loadEnv, roleDbUrl, usesDbUrls, type DbRole } from '@lr/config';

/**
 * Lockdown check for a hosted (Supabase) database: our four roles are unprivileged, Supabase's own API roles
 * (`anon`, `authenticated`) reach none of our schemas, and the merchant-side roles cannot read buyer data.
 * Prints PASS/FAIL per check and never prints a connection string or a password.
 */
const SCHEMAS = ['merchant', 'buyer', 'leads', 'ops', 'pgboss'];
const API_ROLES = ['anon', 'authenticated'];

let failed = 0;
const report = (ok: boolean, name: string, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Error code or class only: driver messages can echo host names. */
function safeError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') return `error code ${e.code}`;
  return e instanceof Error ? e.name : 'unknown error';
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function roleChecks(c: pg.Client) {
  const { rows } = await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
    'select rolname, rolsuper, rolbypassrls from pg_roles where rolname = any($1)',
    [[...DB_ROLES]],
  );
  for (const role of DB_ROLES) {
    const r = rows.find((x) => x.rolname === role);
    if (!r) report(false, `role ${role} exists`, 'missing');
    else report(!r.rolsuper && !r.rolbypassrls, `role ${role} exists with rolsuper=false, rolbypassrls=false`, `rolsuper=${r.rolsuper}, rolbypassrls=${r.rolbypassrls}`);
  }
}

async function apiRoleChecks(c: pg.Client) {
  for (const role of API_ROLES) {
    const exists = await c.query('select 1 from pg_roles where rolname = $1', [role]);
    if (!exists.rowCount) {
      report(true, `${role} has no access to ${SCHEMAS.join(', ')}`, 'role does not exist on this server');
      continue;
    }
    // what information_schema shows to the admin (grants it can see)
    const grants = await c.query<{ n: number }>(
      'select count(*)::int as n from information_schema.role_table_grants where grantee = $1 and table_schema = any($2)',
      [role, SCHEMAS],
    );
    report(grants.rows[0]?.n === 0, `${role}: 0 rows in information_schema.role_table_grants for our schemas`, `${grants.rows[0]?.n} grant rows`);
    // effective privileges, independent of grant visibility
    const eff = await c.query<{ n: number }>(
      `select count(*)::int as n
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = any($2) and c.relkind in ('r','p','v','m','S')
          and has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`,
      [role, SCHEMAS],
    );
    report(eff.rows[0]?.n === 0, `${role}: no effective table privileges in our schemas`, `${eff.rows[0]?.n} objects`);
    const usage = await c.query<{ schema: string }>(
      `select s as schema from unnest($2::text[]) s where exists (select 1 from pg_namespace where nspname = s) and has_schema_privilege($1, s, 'USAGE')`,
      [role, SCHEMAS],
    );
    report(usage.rowCount === 0, `${role}: no USAGE on our schemas`, usage.rows.map((r) => r.schema).join(', '));
  }
}

async function roleReadsBuyer(env: ReturnType<typeof loadEnv<typeof dbEnvSchema>>, role: DbRole, expectDenied: boolean) {
  const name = expectDenied ? `${role}: select from buyer.claims is denied (42501)` : `${role}: select from buyer.claims succeeds (positive control)`;
  try {
    await withClient(roleDbUrl(role, env), (c) => c.query('select 1 from buyer.claims limit 1'));
    report(!expectDenied, name, expectDenied ? 'the query succeeded' : '');
  } catch (e) {
    const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
    if (expectDenied) report(code === '42501', name, safeError(e));
    else report(false, name, safeError(e));
  }
}

const env = loadEnv(dbEnvSchema);
if (!usesDbUrls(env)) {
  console.error('FAIL  no Supabase connection strings in the environment (PG_ADMIN_URL and the four *_DB_URL variables). See "Run against Supabase" in RUNNING.md.');
  process.exit(1);
}

try {
  await withClient(adminDbUrl(env), async (c) => {
    await roleChecks(c);
    await apiRoleChecks(c);
  });
} catch (e) {
  report(false, 'connect as admin', safeError(e));
}
await roleReadsBuyer(env, 'merchant_api', true);
await roleReadsBuyer(env, 'dashboard', true);
await roleReadsBuyer(env, 'buyer_api', false);

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
