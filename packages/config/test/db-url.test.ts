import { describe, expect, it } from 'vitest';
import { adminDbUrl, adminPoolMax, bossPoolMax, dbEnvSchema, loadEnv, poolMax, roleDbUrl, sessionModeWarning, urlPort } from '../src/index.ts';

const env = (vars: Record<string, string>) => loadEnv(dbEnvSchema, vars);
const ALL = {
  PG_ADMIN_URL: 'postgres://postgres.ref:adminpw@pooler.example:5432/postgres?sslmode=verify-full&sslrootcert=/ca.crt',
  MERCHANT_API_DB_URL: 'postgres://merchant_api.ref:p1@pooler.example:6543/postgres?sslmode=verify-full',
  BUYER_API_DB_URL: 'postgres://buyer_api.ref:p2@pooler.example:6543/postgres?sslmode=verify-full',
  WORKER_DB_URL: 'postgres://worker.ref:p3@pooler.example:5432/postgres?sslmode=verify-full',
  DASHBOARD_DB_URL: 'postgres://dashboard.ref:p4@pooler.example:6543/postgres?sslmode=verify-full',
};

describe('database URL precedence', () => {
  it('builds local URLs from PG_* exactly as before when no URL variable is set', () => {
    const e = env({});
    expect(adminDbUrl(e)).toBe('postgres://postgres:postgres@127.0.0.1:5433/receipts');
    expect(roleDbUrl('merchant_api', e)).toBe('postgres://merchant_api:merchant_api_dev@127.0.0.1:5433/receipts');
    expect(roleDbUrl('worker', env({ PG_HOST: 'db', PG_PORT: '5432', PG_DATABASE: 'x', WORKER_DB_PASSWORD: 'p@ss/1' }))).toBe('postgres://worker:p%40ss%2F1@db:5432/x');
  });

  it('returns each full URL verbatim, SSL parameters included, ignoring PG_* and passwords', () => {
    const e = env({ ...ALL, PG_HOST: 'ignored', MERCHANT_API_DB_PASSWORD: 'ignored' });
    expect(adminDbUrl(e)).toBe(ALL.PG_ADMIN_URL);
    expect(roleDbUrl('merchant_api', e)).toBe(ALL.MERCHANT_API_DB_URL);
    expect(roleDbUrl('buyer_api', e)).toBe(ALL.BUYER_API_DB_URL);
    expect(roleDbUrl('worker', e)).toBe(ALL.WORKER_DB_URL);
    expect(roleDbUrl('dashboard', e)).toBe(ALL.DASHBOARD_DB_URL);
  });

  it('fails with a message listing the missing variables when only some URLs are set (admin set, roles missing)', () => {
    const { BUYER_API_DB_URL: _b, WORKER_DB_URL: _w, ...partial } = ALL;
    const e = env(partial);
    for (const call of [() => adminDbUrl(e), () => roleDbUrl('merchant_api', e)]) {
      expect(call).toThrow(/BUYER_API_DB_URL, WORKER_DB_URL/);
    }
    expect(() => roleDbUrl('merchant_api', e)).not.toThrow(/MERCHANT_API_DB_URL,|PG_ADMIN_URL/);
  });

  it('also refuses a role URL without the admin URL (no mixing per role)', () => {
    const e = env({ MERCHANT_API_DB_URL: ALL.MERCHANT_API_DB_URL });
    expect(() => roleDbUrl('worker', e)).toThrow(/PG_ADMIN_URL/);
  });

  it('treats an empty string like unset', () => {
    expect(adminDbUrl(env({ PG_ADMIN_URL: '' }))).toBe('postgres://postgres:postgres@127.0.0.1:5433/receipts');
  });
});

describe('transaction pooler guard', () => {
  it('reads the port from a connection string', () => {
    expect(urlPort(ALL.MERCHANT_API_DB_URL)).toBe(6543);
    expect(urlPort('postgres://u:p@h/db')).toBe(5432);
    expect(urlPort('not a url')).toBeUndefined();
  });
  it('warns for port 6543 only, and the warning contains no URL or password', () => {
    const w = sessionModeWarning('WORKER_DB_URL', ALL.MERCHANT_API_DB_URL);
    expect(w).toMatch(/6543/);
    expect(w).not.toContain('p1');
    expect(w).not.toContain('pooler.example');
    expect(sessionModeWarning('WORKER_DB_URL', ALL.WORKER_DB_URL)).toBeUndefined();
  });
});

describe('pool sizes', () => {
  const HOSTED = {
    PG_ADMIN_URL: 'postgres://postgres.ref:p@host:5432/postgres',
    MERCHANT_API_DB_URL: 'postgres://merchant_api.ref:p@host:6543/postgres',
    BUYER_API_DB_URL: 'postgres://buyer_api.ref:p@host:6543/postgres',
    WORKER_DB_URL: 'postgres://worker.ref:p@host:5432/postgres',
    DASHBOARD_DB_URL: 'postgres://dashboard.ref:p@host:6543/postgres',
  };

  it('keeps the local defaults (10 query, 4 pg-boss, 4 admin) when no URL variable is set', () => {
    const e = env({});
    expect([poolMax(e), bossPoolMax(e), adminPoolMax(e)]).toEqual([10, 4, 4]);
  });

  it('uses small defaults (3, 2, 2) on a hosted database: one app is at most 5 connections per role, well under 15', () => {
    const e = env(HOSTED);
    expect([poolMax(e), bossPoolMax(e), adminPoolMax(e)]).toEqual([3, 2, 2]);
    expect(poolMax(e) + bossPoolMax(e)).toBeLessThanOrEqual(15);
  });

  it('PG_POOL_MAX, PG_BOSS_POOL_MAX and PG_ADMIN_POOL_MAX override the defaults in both modes', () => {
    const set = { PG_POOL_MAX: '6', PG_BOSS_POOL_MAX: '3', PG_ADMIN_POOL_MAX: '1' };
    for (const base of [{}, HOSTED]) {
      const e = env({ ...base, ...set });
      expect([poolMax(e), bossPoolMax(e), adminPoolMax(e)]).toEqual([6, 3, 1]);
    }
  });

  it('rejects a pool size that is not a positive whole number', () => {
    for (const bad of ['0', '-1', '2.5', 'many']) expect(() => env({ PG_POOL_MAX: bad })).toThrow(/PG_POOL_MAX/);
  });
});
