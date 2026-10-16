import { randomBytes } from 'node:crypto';
import { dbEnvSchema, loadEnv, type DbEnv } from '@lr/config';
import { dropDatabase, ensureDatabase, migrate } from './migrate.ts';

export interface TestDb {
  env: DbEnv;
  name: string;
  drop(): Promise<void>;
}

/** A fresh, fully migrated database (roles, RLS, pg-boss). Integration tests use real Postgres from docker compose. */
export async function createTestDb(prefix = 'test'): Promise<TestDb> {
  const base = loadEnv(dbEnvSchema);
  const name = `${prefix}_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  await ensureDatabase(base, name);
  const env = { ...base, PG_DATABASE: name };
  await migrate(env);
  return { env, name, drop: () => dropDatabase(base, name) };
}
