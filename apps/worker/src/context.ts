import type { Db } from '@lr/db';
import type { ObjectStore } from '@lr/storage';
import type { Extractor } from './extractor.ts';

export interface VapidConfig {
  /** `mailto:` or https URL identifying the sender */
  subject: string;
  publicKey: string;
  privateKey: string;
}

/** Everything a job handler needs. Handlers are plain functions of (ctx, job) so tests call them without the pg-boss loop. */
export interface WorkerCtx {
  db: Db;
  s3: ObjectStore;
  extractor: Extractor;
  /** null: no VAPID keys configured; notify-version then skips sending */
  vapid: VapidConfig | null;
  /** distinct uploaders after which an unknown merchant becomes a lead (`status = 'new'`); v2 default 20 */
  leadThreshold: number;
  log: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
  now: () => Date;
}
