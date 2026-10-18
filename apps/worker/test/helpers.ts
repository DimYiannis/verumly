import { readFileSync } from 'node:fs';
import { generateVAPIDKeys } from 'web-push';
import { demoProvider } from '@lr/billing';
import { loadEnv, s3EnvSchema } from '@lr/config';
import { connect, type DbHandle } from '@lr/db';
import { createLocation, createOrg, createTerminal } from '@lr/db/provision';
import { createObjectStore, type ObjectStore } from '@lr/storage';
import { buyerCall, createWorld, loginUser, type BuyerSession, type OrgFixture, type World } from '../../../scripts/lib/testkit.ts';
import { loadCorpus, type CorpusEntry } from '../../../scripts/lib/corpus.ts';
import type { WorkerCtx } from '../src/context.ts';
import { recordedExtractor } from '../src/extractor.ts';
import { extractUpload, type ExtractOutcome } from '../src/jobs/extract-upload.ts';
import { browserSubscription, startPushServer, type BrowserSubscription, type PushServer } from './push-server.ts';

export interface WorkerWorld {
  w: World;
  ctx: WorkerCtx;
  s3: ObjectStore;
  vapid: { publicKey: string; privateKey: string };
  handle: DbHandle;
  /** S3 keys created by this test run, removed on close */
  uploadedKeys: string[];
  corpus: ReturnType<typeof loadCorpus>;
  close(): Promise<void>;
}

/** Worker tests use the mock corpus explicitly: a real receipt dropped into fixtures/receipts-nl/ must not change them. */
const MOCK_FIXTURES = new URL('../../../fixtures/receipts-nl/mock', import.meta.url).pathname;

/** Real Postgres + real S3 + both HTTP apps (Fastify inject) + worker context with the recorded extractor. */
export async function createWorkerWorld(opts: { leadThreshold?: number } = {}): Promise<WorkerWorld> {
  const s3 = createObjectStore(loadEnv(s3EnvSchema));
  const vapid = generateVAPIDKeys();
  const w = await createWorld({ resolveRatePerMinute: 10_000, buyerDeps: { s3, vapidPublicKey: vapid.publicKey, allowLoopbackPush: true } });
  const handle = connect('worker', w.testDb.env);
  const ctx: WorkerCtx = {
    db: handle.db,
    s3,
    extractor: recordedExtractor(MOCK_FIXTURES),
    vapid: { subject: 'mailto:test@receipts.test', ...vapid },
    leadThreshold: opts.leadThreshold ?? 20,
    payments: demoProvider,
    log: () => {},
    now: () => new Date(),
  };
  const uploadedKeys: string[] = [];
  return {
    w,
    ctx,
    s3,
    vapid,
    handle,
    uploadedKeys,
    corpus: loadCorpus({ quiet: true, only: 'mock' }),
    async close() {
      for (const k of uploadedKeys) await s3.remove(k).catch(() => {});
      await handle.close();
      await w.close();
    },
  };
}

export function corpusEntry(ww: WorkerWorld, id: string): CorpusEntry {
  const e = ww.corpus.entries.find((x) => x.id === id);
  if (!e) throw new Error(`corpus has no ${id}`);
  return e;
}

/** An organisation with the KvK / BTW-id printed on a corpus receipt, so the receipt belongs to a known merchant. */
const orgCache = new WeakMap<World, Record<string, OrgFixture>>();
export async function orgForCorpusEntry(w: World, e: CorpusEntry): Promise<OrgFixture> {
  const cache = orgCache.get(w) ?? {};
  orgCache.set(w, cache);
  return (cache[e.id] ??= await createCorpusOrg(w, e));
}

async function createCorpusOrg(w: World, e: CorpusEntry): Promise<OrgFixture> {
  const org = await createOrg(w.adminDb, { legalName: e.truth.merchant.name ?? 'Merchant', kvkNumber: e.truth.merchant.kvk ?? '00000000', vatNumber: e.truth.merchant.vatNumber });
  const loc = await createLocation(w.adminDb, org.id, e.truth.merchant.name ?? 'Location');
  const terminal = await createTerminal(w.adminDb, { orgId: org.id, locationId: loc.id, label: 'T' });
  return { orgId: org.id, locationId: loc.id, kvk: org.kvkNumber, vat: org.vatNumber ?? '', country: 'NL', terminal };
}

export interface UploadResult {
  uploadId: string;
  key: string;
}

/** presign → PUT the bytes to S3 → complete, exactly as the wallet does. The extract job is NOT run. */
export async function uploadBytes(ww: WorkerWorld, who: BuyerSession, bytes: Uint8Array, contentType = 'image/png'): Promise<UploadResult> {
  const created = await buyerCall(ww.w, 'POST', '/v1/me/uploads', { token: who.token, body: { contentType, size: bytes.length } });
  if (created.status !== 201) throw new Error(`presign failed: ${created.status} ${created.text}`);
  const { uploadId, uploadUrl, headers } = created.body as { uploadId: string; uploadUrl: string; headers: Record<string, string> };
  const put = await fetch(uploadUrl, { method: 'PUT', headers, body: bytes });
  if (!put.ok) throw new Error(`S3 PUT failed: ${put.status} ${await put.text()}`);
  const complete = await buyerCall(ww.w, 'POST', `/v1/me/uploads/${uploadId}/complete`, { token: who.token });
  if (complete.status !== 202) throw new Error(`complete failed: ${complete.status} ${complete.text}`);
  const key = `uploads/${who.userId}/${uploadId}`;
  ww.uploadedKeys.push(key);
  return { uploadId, key };
}

export const imageBytes = (e: CorpusEntry): Uint8Array => new Uint8Array(readFileSync(e.imagePath));

/** After every date printed on the mock corpus (the latest is 25 Oct 2026), so no corpus photo reads as future-dated whatever the wall clock. */
export const AFTER_CORPUS = new Date('2026-11-01T12:00:00Z');

/** Upload a corpus image and run the extract job on it, like the worker loop would (clock: {@link AFTER_CORPUS}). */
export async function uploadAndExtract(ww: WorkerWorld, who: BuyerSession, e: CorpusEntry): Promise<UploadResult & { outcome: ExtractOutcome }> {
  const up = await uploadBytes(ww, who, imageBytes(e));
  return { ...up, outcome: await extractUpload({ ...ww.ctx, now: () => AFTER_CORPUS }, { uploadId: up.uploadId }) };
}

export { loginUser, buyerCall };

/** A local push service plus a way to mint browser-side subscriptions for it. */
export async function startPushTarget(): Promise<{ server: PushServer; subscribe(): BrowserSubscription }> {
  return { server: await startPushServer(), subscribe: browserSubscription };
}
