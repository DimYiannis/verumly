import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { adminDbUrl, dbEnvSchema, DB_ROLES, loadEnv, sessionModeWarning, usesDbUrls, type DbEnv } from '@lr/config';
import { BOSS_SCHEMA, QUEUES } from './queues.ts';

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

const PASSWORD_KEY = {
  merchant_api: 'MERCHANT_API_DB_PASSWORD',
  buyer_api: 'BUYER_API_DB_PASSWORD',
  worker: 'WORKER_DB_PASSWORD',
  dashboard: 'DASHBOARD_DB_PASSWORD',
} as const;

/** Tests create and drop databases; that must never happen on a hosted (connection-string) database. */
export function assertLocalOnly(env: DbEnv): void {
  if (usesDbUrls(env)) throw new Error('tests run only against the local Docker Postgres');
}

/** Create `name` if missing (connects to the maintenance DB). Returns true when created. */
export async function ensureDatabase(env: DbEnv, name: string): Promise<boolean> {
  assertLocalOnly(env);
  const c = new pg.Client({ connectionString: adminDbUrl({ ...env, PG_DATABASE: 'postgres' }) });
  await c.connect();
  try {
    const r = await c.query('select 1 from pg_database where datname = $1', [name]);
    if (r.rowCount) return false;
    await c.query(`create database "${name.replace(/"/g, '""')}"`);
    return true;
  } finally {
    await c.end();
  }
}

export async function dropDatabase(env: DbEnv, name: string): Promise<void> {
  assertLocalOnly(env);
  const c = new pg.Client({ connectionString: adminDbUrl({ ...env, PG_DATABASE: 'postgres' }) });
  await c.connect();
  try {
    await c.query(`drop database if exists "${name.replace(/"/g, '""')}" with (force)`);
  } finally {
    await c.end();
  }
}

const MIGRATE_LOCK_KEY = 727_274_001;

/**
 * Roles are cluster-wide, so two migrations running at once (parallel test files, each with its own database)
 * race on CREATE/ALTER ROLE ("tuple concurrently updated"). An advisory lock on the maintenance database serialises them.
 */
export async function migrate(env: DbEnv): Promise<void> {
  const lock = new pg.Client({ connectionString: adminDbUrl({ ...env, PG_DATABASE: 'postgres' }) });
  await lock.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
    await applyMigrations(env);
  } finally {
    await lock.end(); // closing the session releases the lock
  }
}

/** Apply drizzle migrations, set role passwords from env, install pg-boss and grant job-table access. */
async function applyMigrations(env: DbEnv): Promise<void> {
  const pool = new pg.Pool({ connectionString: adminDbUrl(env), max: 2 });
  try {
    await drizzleMigrate(drizzle(pool), { migrationsFolder });
    // Role passwords come from env at migrate time, never from SQL files in git.
    for (const role of DB_ROLES) {
      const pw = env[PASSWORD_KEY[role]].replace(/'/g, "''");
      await pool.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${pw}'`);
    }
  } finally {
    await pool.end();
  }

  const boss = new PgBoss({ connectionString: adminDbUrl(env), schema: BOSS_SCHEMA, max: 2, supervise: false, schedule: false });
  boss.on('error', () => {});
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q);
  await boss.stop({ graceful: false });

  const c = new pg.Client({ connectionString: adminDbUrl(env) });
  await c.connect();
  try {
    const roles = DB_ROLES.join(', ');
    await c.query(`GRANT USAGE ON SCHEMA ${BOSS_SCHEMA} TO ${roles}`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${BOSS_SCHEMA} TO ${roles}`);
    await c.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${BOSS_SCHEMA} TO ${roles}`);
    await c.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${BOSS_SCHEMA} TO ${roles}`);
  } finally {
    await c.end();
  }
}

if (import.meta.main) {
  const env = loadEnv(dbEnvSchema);
  if (usesDbUrls(env)) {
    // Hosted (Supabase): one database, nothing to create; every connection uses PG_ADMIN_URL.
    const warning = sessionModeWarning('PG_ADMIN_URL', adminDbUrl(env));
    if (warning) console.warn(`WARNING: ${warning}`);
    await migrate(env);
    console.log('migrated the database configured by PG_ADMIN_URL');
  } else {
    await ensureDatabase(env, env.PG_DATABASE);
    await migrate(env);
    console.log(`migrated ${env.PG_DATABASE} on ${env.PG_HOST}:${env.PG_PORT}`);
  }
}
