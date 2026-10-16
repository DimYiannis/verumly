import { loadEnv, resolveVapid } from '@lr/config';
import { connect, makeBoss } from '@lr/db';
import { createObjectStore } from '@lr/storage';
import type { WorkerCtx } from './context.ts';
import { workerEnvSchema } from './env.ts';
import { createExtractor } from './extractor-factory.ts';
import { registerJobs } from './worker.ts';

const env = loadEnv(workerEnvSchema);
const vapid = resolveVapid(env);

const { db, close } = connect('worker', env);
const boss = makeBoss('worker', env, { supervise: true, schedule: true });

const ctx: WorkerCtx = {
  db,
  s3: createObjectStore(env),
  extractor: createExtractor(env),
  vapid: vapid ? { subject: env.VAPID_SUBJECT, ...vapid } : null,
  leadThreshold: env.LEAD_THRESHOLD,
  // ids and counts only: never emails, receipt content, endpoints or keys (v2 §2.9)
  log: (event, fields = {}) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  now: () => new Date(),
};

await boss.start();
await registerJobs(boss, ctx);
console.log(JSON.stringify({ level: 'info', event: 'worker_started', extractor: env.EXTRACTOR, vapid: ctx.vapid !== null }));

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await boss.stop({ graceful: true, timeout: 20_000 });
  await close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
