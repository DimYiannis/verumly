import type { FastifyReply, FastifyRequest } from 'fastify';
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
  s3?: S3Deps;
}

export interface S3Deps {
  bucket: string;
  presignPut(key: string, contentType: string): Promise<string>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
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
