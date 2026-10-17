import { afterEach, describe, expect, it } from 'vitest';
import { dbEnvSchema, loadEnv } from '@lr/config';
import { assertLocalOnly, dropDatabase, ensureDatabase } from '../src/migrate.ts';
import { createTestDb } from '../src/testing.ts';

const ADMIN = process.env.PG_ADMIN_URL;

afterEach(() => {
  if (ADMIN === undefined) delete process.env.PG_ADMIN_URL;
  else process.env.PG_ADMIN_URL = ADMIN;
});

describe('tests never touch a hosted database', () => {
  it('createTestDb, ensureDatabase and dropDatabase refuse when PG_ADMIN_URL is set', async () => {
    process.env.PG_ADMIN_URL = 'postgres://postgres:x@hosted.invalid:5432/postgres';
    const env = loadEnv(dbEnvSchema);
    const msg = 'tests run only against the local Docker Postgres';
    await expect(createTestDb('refused')).rejects.toThrow(msg);
    await expect(ensureDatabase(env, 'whatever')).rejects.toThrow(msg);
    await expect(dropDatabase(env, 'whatever')).rejects.toThrow(msg);
    expect(() => assertLocalOnly(env)).toThrow(msg);
  });

  it('allows the local database when no URL variable is set', () => {
    delete process.env.PG_ADMIN_URL;
    expect(() => assertLocalOnly(loadEnv(dbEnvSchema))).not.toThrow();
  });
});
