import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeBoss, QUEUES, type PgBoss } from '@lr/db';
import { buyerCall, createReceipt, loginUser, sql, buildCrf, submit } from '../../../scripts/lib/testkit.ts';
import { registerJobs, SCHEDULES } from '../src/worker.ts';
import { corpusEntry, createWorkerWorld, imageBytes, startPushTarget, type WorkerWorld } from './helpers.ts';

let ww: WorkerWorld;
let workerBoss: PgBoss;
let producer: PgBoss;

beforeAll(async () => {
  ww = await createWorkerWorld();
  workerBoss = makeBoss('worker', ww.w.testDb.env, { supervise: true, schedule: true });
  await workerBoss.start();
  await registerJobs(workerBoss, ww.ctx, { pollingIntervalSeconds: 0.5 });
  producer = makeBoss('buyer_api', ww.w.testDb.env);
  await producer.start();
}, 120_000);
afterAll(async () => {
  await workerBoss.stop({ graceful: false });
  await producer.stop({ graceful: false });
  await ww.close();
});

async function until<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await read();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('pg-boss wiring (role `worker`)', () => {
  it('registers the four cron schedules (rollup, retention, categorise, billing renewals)', async () => {
    const schedules = await workerBoss.getSchedules();
    expect(schedules.map((s) => [s.name, s.cron]).sort()).toEqual(
      [[QUEUES.categorise, SCHEDULES.categorise], [QUEUES.retention, SCHEDULES.retention], [QUEUES.rollupDaily, SCHEDULES.rollupDaily], [QUEUES.billingRenewals, SCHEDULES.billingRenewals]].sort(),
    );
  });

  it('an extract-upload job sent by buyer_api is picked up by the worker loop and the upload reaches done', async () => {
    const who = await loginUser(ww.w);
    const e = corpusEntry(ww, 'mock-supermarkt-statiegeld-bonus');
    const bytes = imageBytes(e);
    const created = await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType: 'image/png', size: bytes.length } });
    const { uploadId, uploadUrl, headers } = created.body as { uploadId: string; uploadUrl: string; headers: Record<string, string> };
    ww.uploadedKeys.push(`uploads/${who.userId}/${uploadId}`);
    expect((await fetch(uploadUrl, { method: 'PUT', headers, body: bytes })).ok).toBe(true);
    const complete = await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/complete`, { token: who.token });
    expect(complete.status).toBe(202);
    // forward the job the API enqueued (the test world's boss is a recorder) to the real queue, with the same options
    const job = ww.w.buyerJobs.find((j) => j.name === QUEUES.extractUpload && (j.data as { uploadId: string }).uploadId === uploadId)!;
    await producer.send(job.name, job.data as object, job.options as object);
    const status = await until(async () => {
      const [r] = await sql<{ status: string }>(ww.w, 'select status from buyer.uploads where id = $1', [uploadId]);
      return r?.status === 'processing' ? undefined : r?.status;
    }, 'upload to finish');
    expect(status).toBe('done');
  });

  it('a notify-version job sent by merchant_api is delivered by the worker loop as one push', async () => {
    const target = await startPushTarget();
    try {
      const who = await loginUser(ww.w);
      const sub = target.subscribe();
      expect((await buyerCall(ww.w, 'POST', '/v1/me/push-subscriptions', { token: who.token, body: { endpoint: `${target.server.baseUrl}/loop`, keys: { p256dh: sub.p256dh, auth: sub.auth } } })).status).toBe(201);
      const r = await createReceipt(ww.w, ww.w.orgA, { state: 'presented' });
      expect((await buyerCall(ww.w, 'POST', '/v1/me/claims', { token: who.token, body: { receiptId: r.receiptId, secret: r.secret } })).status).toBe(201);
      expect((await submit(ww.w.merchant, ww.w.orgA, buildCrf({ receiptId: r.receiptId, version: 2, state: 'paid', org: ww.w.orgA }))).status).toBe(201);
      const merchantJob = ww.w.jobs.find((j) => j.name === QUEUES.notifyVersion && (j.data as { receiptId: string }).receiptId === r.receiptId)!;
      await producer.send(merchantJob.name, merchantJob.data as object, { singletonKey: `${r.receiptId}:2` });
      await until(async () => (target.server.requests.length > 0 ? true : undefined), 'push delivery');
      await new Promise((res) => setTimeout(res, 1500));
      expect(target.server.requests).toHaveLength(1);
    } finally {
      await target.server.close();
    }
  });
});
