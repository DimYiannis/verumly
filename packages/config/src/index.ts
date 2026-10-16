import { z } from 'zod';

/**
 * Validate process.env against a zod schema at startup. Exits with a readable message on failure.
 * Local-dev defaults live in the schemas so `docker compose up` + `pnpm dev` works without a .env file.
 */
export function loadEnv<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const r = schema.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return r.data;
}

export const DB_ROLES = ['merchant_api', 'buyer_api', 'worker', 'dashboard'] as const;
export type DbRole = (typeof DB_ROLES)[number];

/** Dev passwords match docker-compose / .env.example; production sets real ones. */
export const dbEnvSchema = z.object({
  PG_HOST: z.string().default('127.0.0.1'),
  PG_PORT: z.coerce.number().default(5433),
  PG_DATABASE: z.string().default('receipts'),
  PG_ADMIN_USER: z.string().default('postgres'),
  PG_ADMIN_PASSWORD: z.string().default('postgres'),
  MERCHANT_API_DB_PASSWORD: z.string().default('merchant_api_dev'),
  BUYER_API_DB_PASSWORD: z.string().default('buyer_api_dev'),
  WORKER_DB_PASSWORD: z.string().default('worker_dev'),
  DASHBOARD_DB_PASSWORD: z.string().default('dashboard_dev'),
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

export function adminDbUrl(e: DbEnv): string {
  return `postgres://${e.PG_ADMIN_USER}:${encodeURIComponent(e.PG_ADMIN_PASSWORD)}@${e.PG_HOST}:${e.PG_PORT}/${e.PG_DATABASE}`;
}

export function roleDbUrl(role: DbRole, e: DbEnv): string {
  const pw = {
    merchant_api: e.MERCHANT_API_DB_PASSWORD,
    buyer_api: e.BUYER_API_DB_PASSWORD,
    worker: e.WORKER_DB_PASSWORD,
    dashboard: e.DASHBOARD_DB_PASSWORD,
  }[role];
  return `postgres://${role}:${encodeURIComponent(pw)}@${e.PG_HOST}:${e.PG_PORT}/${e.PG_DATABASE}`;
}

export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.string().default('http://127.0.0.1:9090'),
  S3_REGION: z.string().default('eu-west-1'),
  S3_BUCKET: z.string().default('receipts'),
  S3_ACCESS_KEY: z.string().default('minio'),
  S3_SECRET_KEY: z.string().default('minio12345'),
});

export const sharedEnvSchema = z.object({
  RECEIPT_HOST: z.string().default('http://localhost:3001'),
  CLAIM_WINDOW_DAYS: z.coerce.number().default(90),
  LOG_LEVEL: z.string().default('info'),
});

/** pino options shared by every service: request IDs only, secrets/emails/payloads redacted (v2 §2.9, §14). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-signature"]',
  '*.authorization',
  '*.secret',
  '*.email',
  '*.payload',
  '*.token',
  '*.code',
  'secret',
  'email',
  'payload',
  'token',
  'authorization',
];
export function loggerOptions(level: string) {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // log only method, URL path (never query: it may carry tokens) and request id
    serializers: {
      req(req: { id: string; method: string; url: string }) {
        return { id: req.id, method: req.method, url: req.url.split('?')[0] };
      },
    },
  };
}
