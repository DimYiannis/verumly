import { describe, expect, it } from 'vitest';
import { dbEnvSchema, loadEnv } from '@lr/config';
import { shouldSetRolePasswords } from '../src/migrate.ts';

const HOSTED = {
  PG_ADMIN_URL: 'postgres://postgres.ref:p@host:5432/postgres',
  MERCHANT_API_DB_URL: 'postgres://merchant_api.ref:p@host:6543/postgres',
  BUYER_API_DB_URL: 'postgres://buyer_api.ref:p@host:6543/postgres',
  WORKER_DB_URL: 'postgres://worker.ref:p@host:5432/postgres',
  DASHBOARD_DB_URL: 'postgres://dashboard.ref:p@host:6543/postgres',
};

describe('role passwords are not rotated by every migration on a hosted database', () => {
  it('local Docker database: set by default (fresh clones and tests need login roles), can be switched off', () => {
    const local = loadEnv(dbEnvSchema, {});
    expect(shouldSetRolePasswords(local)).toBe(true);
    expect(shouldSetRolePasswords(local, { setRolePasswords: false })).toBe(false);
  });

  it('hosted database: not set unless asked for', () => {
    const hosted = loadEnv(dbEnvSchema, HOSTED);
    expect(shouldSetRolePasswords(hosted)).toBe(false);
    expect(shouldSetRolePasswords(hosted, {})).toBe(false);
    expect(shouldSetRolePasswords(hosted, { setRolePasswords: true })).toBe(true);
  });
});
