import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEV_ENCRYPTION_KEY } from '../server/utils/env.ts';

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return (await import('../server/utils/env.ts')).useEnv();
}

afterEach(() => vi.unstubAllEnvs());

describe('env validation', () => {
  it('has working development defaults and a 32-byte dev key', async () => {
    const e = await load({ NODE_ENV: 'development', DASHBOARD_ENCRYPTION_KEY: '' });
    expect(e.MERCHANT_API_URL).toBe('http://127.0.0.1:4001');
    expect(e.RECEIPT_HOST).toBe('http://localhost:3001');
    expect(e.encryptionKey).toBe(DEV_ENCRYPTION_KEY);
    expect(Buffer.from(DEV_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect(e.cookieSecure).toBe(false);
  });

  it('refuses to start in production without an encryption key, and defaults cookies to Secure', async () => {
    await expect(load({ NODE_ENV: 'production', DASHBOARD_ENCRYPTION_KEY: '' })).rejects.toThrow(/DASHBOARD_ENCRYPTION_KEY/);
    const e = await load({ NODE_ENV: 'production', DASHBOARD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') });
    expect(e.cookieSecure).toBe(true);
  });

  it('rejects a key of the wrong length and malformed URLs', async () => {
    await expect(load({ DASHBOARD_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).rejects.toThrow(/32 bytes/);
    await expect(load({ MERCHANT_API_URL: 'not a url', DASHBOARD_ENCRYPTION_KEY: '' })).rejects.toThrow(/MERCHANT_API_URL/);
  });

  it('billing: only the demo provider; the renewal simulation follows DEMO_MODE unless set', async () => {
    expect((await load({ NODE_ENV: 'development' })).BILLING_PROVIDER).toBe('demo');
    await expect(load({ BILLING_PROVIDER: 'mollie' })).rejects.toThrow(/BILLING_PROVIDER/);
    expect((await load({ DEMO_MODE: 'true' })).billingSimulation).toBe(true);
    expect((await load({ DEMO_MODE: 'false' })).billingSimulation).toBe(false);
    expect((await load({ DEMO_MODE: 'false', BILLING_SIMULATE_RENEWAL: 'true' })).billingSimulation).toBe(true);
  });
});
