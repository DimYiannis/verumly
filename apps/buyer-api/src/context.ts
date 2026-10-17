import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ObjectStore } from '@lr/storage';
import type { Db, PgBoss } from '@lr/db';

export interface Mailer {
  sendCode(to: string, code: string): Promise<void>;
}

export interface AppDeps {
  db: Db;
  boss: Pick<PgBoss, 'send'>;
  mailer: Mailer;
  /** origin allowed by CORS: the wallet's RECEIPT_HOST */
  allowedOrigin: string;
  logLevel?: string;
  /** test hook: capture log lines (privacy canary) */
  logStream?: NodeJS.WritableStream;
  /** per-IP requests/minute on public resolver routes (v2 §10: 30) */
  resolveRatePerMinute?: number;
  /** object storage for uploads; routes needing it answer 503 when absent */
  s3?: ObjectStore;
  /** demo sign-in: the seeded buyer who may sign in without an email code (development / hackathon only) */
  demoUserEmail?: string;
  /** VAPID public key served to the wallet; null/absent: push is not configured */
  vapidPublicKey?: string | null;
  /** version string stored with every consent row */
  policyVersion?: string;
  /** accept plain-http loopback push endpoints (local tests); false in production */
  allowLoopbackPush?: boolean;
}

export interface Session {
  userId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session;
  }
}

export type Reply = FastifyReply;
export type Req = FastifyRequest;
