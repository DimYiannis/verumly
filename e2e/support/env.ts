import { dbEnvSchema, loadEnv } from '@lr/config';

/** Default ports of `pnpm dev`. The wallet origin must be `localhost:3001`: buyer-api's CORS allows only RECEIPT_HOST. */
export const URLS = {
  merchantApi: 'http://127.0.0.1:4001',
  buyerApi: 'http://127.0.0.1:4002',
  merchantWeb: 'http://localhost:3000',
  wallet: 'http://localhost:3001',
  mailpit: process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025',
} as const;

export const dbEnv = loadEnv(dbEnvSchema);
