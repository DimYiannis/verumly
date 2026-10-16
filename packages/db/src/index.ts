import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { adminDbUrl, roleDbUrl, sessionModeWarning, type DbEnv, type DbRole } from '@lr/config';
import * as schema from './schema.ts';
import { BOSS_SCHEMA } from './queues.ts';

export * as tables from './schema.ts';
export * from './queues.ts';
export { sql };
export type { PgBoss };

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** The worker holds long-lived pg-boss sessions: warn (once per process) if it was pointed at a transaction pooler. */
let warnedWorker = false;
function warnWorkerPooler(role: DbRole, env: DbEnv): void {
  if (role !== 'worker' || warnedWorker) return;
  const w = sessionModeWarning('WORKER_DB_URL', roleDbUrl(role, env));
  if (w) {
    warnedWorker = true;
    console.warn(`WARNING: ${w}`);
  }
}

export function connect(role: DbRole, env: DbEnv, opts: { max?: number } = {}): DbHandle {
  warnWorkerPooler(role, env);
  const pool = new pg.Pool({ connectionString: roleDbUrl(role, env), max: opts.max ?? 10 });
  // a dead idle client must not crash the process
  pool.on('error', () => {});
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}

/**
 * A connection as the database owner (no role restrictions, RLS bypassed). Only for provisioning: the seed, test fixtures
 * and onboarding scripts. Services always connect as their own role.
 */
export function connectAdmin(env: DbEnv, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: adminDbUrl(env), max: opts.max ?? 4 });
  pool.on('error', () => {});
  return { db: drizzle(pool, { schema }), pool, close: () => pool.end() };
}

/** Run `fn` in a transaction with `app.org_id` set, so row-level security scopes every statement to the org. */
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/** A pg-boss instance for sending (and, in the worker, processing) jobs. Schema is created by `migrate`. */
export function makeBoss(role: DbRole, env: DbEnv, opts: { supervise?: boolean; schedule?: boolean } = {}): PgBoss {
  warnWorkerPooler(role, env);
  const boss = new PgBoss({
    connectionString: roleDbUrl(role, env),
    schema: BOSS_SCHEMA,
    migrate: false,
    createSchema: false,
    supervise: opts.supervise ?? false,
    schedule: opts.schedule ?? false,
    max: 4,
  });
  boss.on('error', () => {});
  return boss;
}
export * from './matching.ts';
