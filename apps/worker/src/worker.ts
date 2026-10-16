import type { ExportJob, ExtractUploadJob, NotifyVersionJob, PgBoss, RollupDailyJob } from '@lr/db';
import { QUEUES } from '@lr/db';
import type { WorkerCtx } from './context.ts';
import { categorise } from './jobs/categorise.ts';
import { runExport } from './jobs/export.ts';
import { extractUpload } from './jobs/extract-upload.ts';
import { notifyVersion } from './jobs/notify-version.ts';
import { retention } from './jobs/retention.ts';
import { rollupDaily } from './jobs/rollup-daily.ts';

export const SCHEDULES = {
  /** every 30 minutes: recompute the last 3 days */
  rollupDaily: '*/30 * * * *',
  /** daily at 03:30 */
  retention: '30 3 * * *',
  /** every 10 minutes: categorise lines of newly ingested receipts */
  categorise: '*/10 * * * *',
} as const;

/** Register every job handler and the cron schedules on a started pg-boss (role `worker`, `schedule: true`). */
export async function registerJobs(boss: PgBoss, ctx: WorkerCtx, opts: { pollingIntervalSeconds?: number } = {}): Promise<void> {
  const poll = opts.pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds: opts.pollingIntervalSeconds };
  await boss.work<ExtractUploadJob, void, { includeMetadata: true }>(QUEUES.extractUpload, { includeMetadata: true, ...poll }, async ([job]) => {
    if (job) await extractUpload(ctx, job.data, { finalAttempt: job.retryCount >= job.retryLimit });
  });
  await boss.work<NotifyVersionJob>(QUEUES.notifyVersion, poll, async ([job]) => {
    if (job) await notifyVersion(ctx, job.data);
  });
  await boss.work<RollupDailyJob>(QUEUES.rollupDaily, poll, async ([job]) => {
    if (job) await rollupDaily(ctx, job.data);
  });
  await boss.work<ExportJob>(QUEUES.export, poll, async ([job]) => {
    if (job) await runExport(ctx, job.data);
  });
  await boss.work(QUEUES.retention, poll, async () => {
    await retention(ctx);
  });
  await boss.work(QUEUES.categorise, poll, async () => {
    await categorise(ctx);
  });
  await boss.schedule(QUEUES.rollupDaily, SCHEDULES.rollupDaily, {}, { tz: 'Europe/Amsterdam' });
  await boss.schedule(QUEUES.retention, SCHEDULES.retention, {}, { tz: 'Europe/Amsterdam' });
  await boss.schedule(QUEUES.categorise, SCHEDULES.categorise, {}, { tz: 'Europe/Amsterdam' });
}
