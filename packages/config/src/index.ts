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
  // Full connection strings (Supabase). When set they are used verbatim, including SSL params such as
  // ?sslmode=verify-full&sslrootcert=/abs/path/ca.crt, and the PG_* / *_PASSWORD values above are ignored.
  PG_ADMIN_URL: z.string().optional(),
  // Pool sizes. Unset: 10 / 4 / 4 locally; 3 / 2 / 2 when the connection-string variables are set, because Supabase's
  // pooler allows 15 connections per user+database and each app also runs a pg-boss pool under the same user.
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
  PG_BOSS_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
  PG_ADMIN_POOL_MAX: z.coerce.number().int().min(1).max(100).optional(),
  MERCHANT_API_DB_URL: z.string().optional(),
  BUYER_API_DB_URL: z.string().optional(),
  WORKER_DB_URL: z.string().optional(),
  DASHBOARD_DB_URL: z.string().optional(),
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

const ROLE_URL_KEY = {
  merchant_api: 'MERCHANT_API_DB_URL',
  buyer_api: 'BUYER_API_DB_URL',
  worker: 'WORKER_DB_URL',
  dashboard: 'DASHBOARD_DB_URL',
} as const;
const URL_KEYS = ['PG_ADMIN_URL', ...Object.values(ROLE_URL_KEY)] as const;

/** True when the database is configured through full connection strings (Supabase) instead of PG_* values. */
export function usesDbUrls(e: DbEnv): boolean {
  return URL_KEYS.some((k) => e[k] !== undefined && e[k] !== '');
}

/**
 * Either none of the connection-string variables are set (local Docker, built from PG_*), or all five are.
 * Mixing Supabase and local per role is refused at startup, naming the missing variables.
 */
export function assertDbUrlConsistency(e: DbEnv): void {
  if (!usesDbUrls(e)) return;
  const missing = URL_KEYS.filter((k) => e[k] === undefined || e[k] === '');
  if (missing.length > 0) {
    throw new Error(
      `Incomplete database configuration: some of the connection-string variables are set but these are missing: ${missing.join(', ')}. Set all five or none (no mixing Supabase and local per role).`,
    );
  }
}

/** Connections in an app's query pool (`PG_POOL_MAX`; small default on a hosted database). */
export function poolMax(e: DbEnv): number {
  return e.PG_POOL_MAX ?? (usesDbUrls(e) ? 3 : 10);
}

/** Connections in an app's pg-boss pool (`PG_BOSS_POOL_MAX`). */
export function bossPoolMax(e: DbEnv): number {
  return e.PG_BOSS_POOL_MAX ?? (usesDbUrls(e) ? 2 : 4);
}

/** Connections for admin work: seed, provisioning, migrations (`PG_ADMIN_POOL_MAX`). */
export function adminPoolMax(e: DbEnv): number {
  return e.PG_ADMIN_POOL_MAX ?? (usesDbUrls(e) ? 2 : 4);
}

export function adminDbUrl(e: DbEnv): string {
  assertDbUrlConsistency(e);
  if (e.PG_ADMIN_URL) return e.PG_ADMIN_URL;
  return `postgres://${e.PG_ADMIN_USER}:${encodeURIComponent(e.PG_ADMIN_PASSWORD)}@${e.PG_HOST}:${e.PG_PORT}/${e.PG_DATABASE}`;
}

export function roleDbUrl(role: DbRole, e: DbEnv): string {
  assertDbUrlConsistency(e);
  const full = e[ROLE_URL_KEY[role]];
  if (full) return full;
  const pw = {
    merchant_api: e.MERCHANT_API_DB_PASSWORD,
    buyer_api: e.BUYER_API_DB_PASSWORD,
    worker: e.WORKER_DB_PASSWORD,
    dashboard: e.DASHBOARD_DB_PASSWORD,
  }[role];
  return `postgres://${role}:${encodeURIComponent(pw)}@${e.PG_HOST}:${e.PG_PORT}/${e.PG_DATABASE}`;
}

/** Port of a connection string, or undefined if it cannot be parsed. Never exposes the URL itself. */
export function urlPort(url: string): number | undefined {
  try {
    const p = new URL(url).port;
    return p ? Number(p) : 5432;
  } catch {
    return undefined;
  }
}

const TRANSACTION_POOLER_PORT = 6543;

/**
 * Worker and migrations hold long-lived sessions (pg-boss, advisory lock) and must not use a transaction pooler.
 * Returns the warning text (no URL, no secrets) or undefined.
 */
export function sessionModeWarning(what: string, url: string): string | undefined {
  return urlPort(url) === TRANSACTION_POOLER_PORT
    ? `${what} points at port ${TRANSACTION_POOLER_PORT} (transaction pooler). Use the session pooler (5432) or the direct connection: pg-boss and the migration advisory lock need session state.`
    : undefined;
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

/** Development-only Web Push key pair (public on purpose, like the dashboard's dev encryption key) so push works under `pnpm dev` with no setup. */
export const DEV_VAPID = {
  publicKey: 'BKx1658NbGxe_ca5tgO7n31QyvcqCUb6oak6tMgWhlFLwlt1JEJAstDuBES-xI6VOpLsjsuhmOauqNzpKdF9pyw',
  privateKey: 'hFTJp2JRQ5JR9lgLPMP0gIZL-RZpOj6D2qV1SXmrLBI',
} as const;

/** The configured VAPID pair; the development pair outside production; `null` in production when unset (push is then off). */
export function resolveVapid(e: { VAPID_PUBLIC_KEY?: string | undefined; VAPID_PRIVATE_KEY?: string | undefined }): { publicKey: string; privateKey: string } | null {
  if (e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY) return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY };
  return process.env.NODE_ENV === 'production' ? null : DEV_VAPID;
}
