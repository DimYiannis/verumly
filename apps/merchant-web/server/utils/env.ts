import { z } from 'zod';
import { dbEnvSchema, loadEnv, s3EnvSchema } from '@lr/config';

/** Public development key (see .env.example). Only used outside production. */
export const DEV_ENCRYPTION_KEY = 'ZGV2LW9ubHktZGFzaGJvYXJkLWVuY3J5cHRpb24hISE=';

const envSchema = dbEnvSchema.extend(s3EnvSchema.shape).extend({
  NODE_ENV: z.string().default('development'),
  DASHBOARD_ENCRYPTION_KEY: z.string().optional(),
  MERCHANT_API_URL: z.url().default('http://127.0.0.1:4001'),
  RECEIPT_HOST: z.url().default('http://localhost:3001'),
  DASHBOARD_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  /** login / TOTP attempts per client IP per 5 minutes */
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  /** demo sign-in as the seeded owner, no TOTP typing. On outside production unless set; never enable it on a real deployment */
  DEMO_MODE: z.stringbool().default(process.env.NODE_ENV !== 'production'),
});

export interface WebEnv extends z.infer<typeof envSchema> {
  encryptionKey: string;
  cookieSecure: boolean;
}

let cached: WebEnv | undefined;

/** Validated process environment; throws a readable error (at server start, see plugins/env.ts) when invalid. */
export function useEnv(): WebEnv {
  if (cached) return cached;
  const e = loadEnv(envSchema);
  const production = e.NODE_ENV === 'production';
  const encryptionKey = e.DASHBOARD_ENCRYPTION_KEY || (production ? '' : DEV_ENCRYPTION_KEY);
  if (Buffer.from(encryptionKey, 'base64').length !== 32) {
    throw new Error('Invalid environment:\n  DASHBOARD_ENCRYPTION_KEY: required in production, must be 32 bytes base64');
  }
  cached = { ...e, encryptionKey, cookieSecure: e.DASHBOARD_COOKIE_SECURE ? e.DASHBOARD_COOKIE_SECURE === 'true' : production };
  return cached;
}
