import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, count, desc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { MemoryStore, TerminalSdk, type DraftLine } from '@lr/terminal-sdk';
import { createMerchantUser } from '@lr/dashboard-core';
import { loadEnv, usesDbUrls } from '@lr/config';
import { connect, connectAdmin, tables, type Db } from '@lr/db';
import { createLocation, createOrg, createTerminal } from '@lr/db/provision';
import { parseExtraction, truthPrintedAtUtc } from '@lr/receipt-nl';
import { createObjectStore } from '@lr/storage';
import { buildApp as buildMerchantApi } from '../apps/merchant-api/src/app.ts';
import { allocateEqual } from '../apps/buyer-api/src/split-math.ts';
import { workerEnvSchema, type WorkerEnv } from '../apps/worker/src/env.ts';
import { createExtractor } from '../apps/worker/src/extractor-factory.ts';
import type { WorkerCtx } from '../apps/worker/src/context.ts';
import { categorise } from '../apps/worker/src/jobs/categorise.ts';
import { extractUpload } from '../apps/worker/src/jobs/extract-upload.ts';
import { rollupDaily } from '../apps/worker/src/jobs/rollup-daily.ts';
import { loadCorpus, readRecorded, type CorpusEntry } from './lib/corpus.ts';
import { runningApps } from './lib/running-apps.ts';

/**
 * Local-dev seed (v2 §15). Idempotent: every step checks what exists and only adds what is missing.
 * Receipts go through the real signing and ingest path: TerminalSdk signs, its flusher POSTs to merchant-api's real
 * Fastify app (in-process, so no server has to be running), which verifies signatures and stores the versions.
 */

export const SEED = {
  orgName: 'Café Het Plein',
  kvk: '12345678',
  vat: 'NL123456789B01',
  postcode: '1011AB',
  ownerEmail: 'owner@example.test',
  ownerPassword: 'owner-dev-password',
  buyerEmail: 'buyer@example.test',
  friendEmail: 'anna@example.test',
  terminalLabels: ['Till 1', 'Till 2'],
  receiptTarget: 200,
  days: 60,
  claimedTarget: 30,
  uploadTarget: 3,
} as const;

const SECRETS_PATH = fileURLToPath(new URL('../.local/seed.json', import.meta.url));

interface TerminalSecrets {
  terminalId: string;
  label: string;
  apiKey: string;
  privateKey: string;
}

/** What the oracle in the tests needs to recompute BTW independently of the code under test. */
export interface PlannedReceipt {
  receiptId: string;
  secret: string;
  finalState: 'paid' | 'presented' | 'void';
  /** createdAt of the final version, ISO UTC */
  finalAt: string;
  lines: Array<{ qty: string; unitPrice: number; vatRate: 21 | 9 }>;
  cash: boolean;
}

export interface SeedResult {
  orgId: string;
  buyerId: string;
  created: { receipts: number; claims: number; uploads: number; terminals: number };
  planned: PlannedReceipt[];
  terminals: TerminalSecrets[];
}

// ---------------------------------------------------------------- deterministic content

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MENU: Array<{ description: string; unitPrice: number; vatRate: 21 | 9 }> = [
  { description: 'Koffie', unitPrice: 340, vatRate: 9 },
  { description: 'Cappuccino', unitPrice: 385, vatRate: 9 },
  { description: 'Thee', unitPrice: 310, vatRate: 9 },
  { description: 'Appeltaart', unitPrice: 475, vatRate: 9 },
  { description: 'Tosti ham kaas', unitPrice: 650, vatRate: 9 },
  { description: 'Uitsmijter', unitPrice: 995, vatRate: 9 },
  { description: 'Cola', unitPrice: 295, vatRate: 9 },
  { description: 'Bier', unitPrice: 389, vatRate: 21 },
  { description: 'Wijn wit', unitPrice: 495, vatRate: 21 },
  { description: 'Gin tonic', unitPrice: 895, vatRate: 21 },
];

/** Euro-cent amounts with odd cents so that 5-cent cash rounding actually happens. */
function planLines(rand: () => number): PlannedReceipt['lines'] {
  const n = 1 + Math.floor(rand() * 4);
  const lines: PlannedReceipt['lines'] = [];
  for (let i = 0; i < n; i++) {
    const item = MENU[Math.floor(rand() * MENU.length)]!;
    lines.push({ qty: String(1 + Math.floor(rand() * 3)), unitPrice: item.unitPrice, vatRate: item.vatRate });
  }
  return lines;
}

const draftLines = (planned: PlannedReceipt['lines']): DraftLine[] =>
  planned.map((l) => ({ description: MENU.find((m) => m.unitPrice === l.unitPrice && m.vatRate === l.vatRate)!.description, qty: l.qty, unitPrice: l.unitPrice, vatRate: l.vatRate }));

// ---------------------------------------------------------------- in-process fetch to merchant-api

function injectFetch(app: Awaited<ReturnType<typeof buildMerchantApi>>): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const res = await app.inject({ method: 'POST', url: `${url.pathname}${url.search}`, headers, payload: typeof init?.body === 'string' ? init.body : undefined });
    return new Response(res.body, { status: res.statusCode, headers: { 'content-type': String(res.headers['content-type'] ?? 'application/json') } });
  };
}

const secretsFile = z.object({ terminals: z.array(z.object({ terminalId: z.string(), label: z.string(), apiKey: z.string(), privateKey: z.string() })) });

function readSecrets(): TerminalSecrets[] {
  return existsSync(SECRETS_PATH) ? secretsFile.parse(JSON.parse(readFileSync(SECRETS_PATH, 'utf8'))).terminals : [];
}

function writeSecrets(terminals: TerminalSecrets[]): void {
  mkdirSync(dirname(SECRETS_PATH), { recursive: true });
  writeFileSync(SECRETS_PATH, `${JSON.stringify({ note: 'dev-only terminal credentials created by pnpm db:seed (git-ignored)', terminals }, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------- seed

export interface SeedOptions {
  env: WorkerEnv;
  /** fixed "now" for reproducible tests */
  now?: Date;
  /** do not write .local/seed.json */
  secretsPath?: false;
  log?: (line: string) => void;
}

async function ensureOrg(db: Db, o: { legalName: string; kvk: string; vat: string | null }) {
  const [existing] = await db.select().from(tables.organizations).where(eq(tables.organizations.kvkNumber, o.kvk));
  if (existing) return existing;
  return createOrg(db, { legalName: o.legalName, kvkNumber: o.kvk, vatNumber: o.vat });
}

async function ensureLocation(db: Db, orgId: string, name: string, postcode: string) {
  const [existing] = await db.select().from(tables.locations).where(and(eq(tables.locations.orgId, orgId), eq(tables.locations.name, name)));
  return existing ?? createLocation(db, orgId, name, postcode);
}

export async function runSeed(opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? new Date();
  const admin = connectAdmin(opts.env);
  const merchantHandle = connect('merchant_api', opts.env);
  const workerHandle = connect('worker', opts.env);
  const created = { receipts: 0, claims: 0, uploads: 0, terminals: 0 };
  const planned: PlannedReceipt[] = [];
  try {
    const db = admin.db;
    const org = await ensureOrg(db, { legalName: 'Café Het Plein B.V.', kvk: SEED.kvk, vat: SEED.vat });
    const location = await ensureLocation(db, org.id, SEED.orgName, SEED.postcode);

    // terminals: the API key is shown once, so keep what we created in a git-ignored file for later runs
    const known = readSecrets();
    const terminals: TerminalSecrets[] = [];
    for (const label of SEED.terminalLabels) {
      const [row] = await db.select({ id: tables.terminals.id }).from(tables.terminals).where(and(eq(tables.terminals.orgId, org.id), eq(tables.terminals.label, label)));
      const secret = known.find((k) => k.terminalId === row?.id);
      if (row && secret) {
        terminals.push(secret);
        continue;
      }
      if (row) {
        terminals.push({ terminalId: row.id, label, apiKey: '', privateKey: '' });
        continue;
      }
      const t = await createTerminal(db, { orgId: org.id, locationId: location.id, label });
      terminals.push({ terminalId: t.terminalId, label, apiKey: t.apiKey, privateKey: t.keys.privateKey });
      created.terminals++;
      log(`terminal "${label}" created: id ${t.terminalId}\n  API key (shown once): ${t.apiKey}\n  signing key (base64url seed): ${t.keys.privateKey}`);
    }
    // merged by terminal id, so seeding another database never loses the keys of this one
    if (opts.secretsPath !== false && created.terminals > 0) writeSecrets([...known.filter((k) => !terminals.some((t) => t.terminalId === k.terminalId)), ...terminals.filter((t) => t.apiKey)]);

    // users
    const [owner] = await db.select({ id: tables.merchantUsers.id }).from(tables.merchantUsers).where(eq(tables.merchantUsers.email, SEED.ownerEmail));
    if (!owner) {
      await createMerchantUser(db, { orgId: org.id, email: SEED.ownerEmail, password: SEED.ownerPassword, role: 'owner' });
      log(`dashboard user ${SEED.ownerEmail} / ${SEED.ownerPassword} (dev only; TOTP is enrolled at first login)`);
    }
    let [buyer] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, SEED.buyerEmail));
    if (!buyer) [buyer] = await db.insert(tables.users).values({ email: SEED.buyerEmail }).returning({ id: tables.users.id });
    const buyerId = buyer!.id;

    // receipts through the real signing + ingest path
    const merchantApi = await buildMerchantApi({ db: merchantHandle.db, boss: { send: async () => null }, claimWindowDays: 90, logLevel: 'warn' });
    const [existing] = await db.select({ n: count() }).from(tables.receipts).where(eq(tables.receipts.orgId, org.id));
    const missing = Math.max(0, SEED.receiptTarget - (existing?.n ?? 0));
    if (missing > 0) {
      const usable = terminals.filter((t) => t.apiKey && t.privateKey);
      if (usable.length < SEED.terminalLabels.length) {
        throw new Error('terminal credentials are missing (.local/seed.json): reset the database (docker compose down -v) and seed again');
      }
      let clock = now;
      const sdks = usable.map(
        (t) =>
          new TerminalSdk({
            apiBase: 'http://merchant-api.local',
            receiptHost: 'http://localhost:3001',
            terminalId: t.terminalId,
            apiKey: t.apiKey,
            privateKey: t.privateKey,
            merchant: { kvkNumber: SEED.kvk, vatNumber: SEED.vat, name: SEED.orgName, locationId: location.id },
            store: new MemoryStore(),
            fetch: injectFetch(merchantApi),
            now: () => clock,
          }),
      );
      const rand = mulberry32(20261016 + (existing?.n ?? 0));
      for (let i = 0; i < missing; i++) {
        const sdk = sdks[i % sdks.length]!;
        // oldest first, spread evenly over the last 60 days, evening-weighted opening hours 10:00-23:00
        const dayOffset = SEED.days - 1 - Math.floor((i * SEED.days) / missing);
        const minutes = 10 * 60 + Math.floor(rand() * 13 * 60);
        const at = new Date(now.getTime() - dayOffset * 86_400_000);
        at.setUTCHours(0, 0, 0, 0);
        const start = new Date(at.getTime() + minutes * 60_000);
        const lines = planLines(rand);
        const cash = rand() < 0.3;
        const kind = i >= missing - 5 ? 'presented' : i % 50 === 7 ? 'void' : 'paid';
        const via2Versions = kind === 'paid' && rand() < 0.2;

        clock = start;
        const first = await sdk.createReceipt({ state: kind === 'presented' ? 'presented' : via2Versions ? 'presented' : 'paid', lines: draftLines(lines), ...(kind !== 'presented' && !via2Versions ? { payments: [{ method: cash ? 'cash' : 'card' }] } : {}) });
        let finalAt = start;
        if (via2Versions) {
          clock = new Date(start.getTime() + 12 * 60_000);
          await sdk.addVersion(first.receiptId, { state: 'paid', payments: [{ method: cash ? 'cash' : 'card' }] });
          finalAt = clock;
        }
        if (kind === 'void') {
          clock = new Date(start.getTime() + 5 * 60_000);
          await sdk.voidReceipt(first.receiptId);
          finalAt = clock;
        }
        planned.push({ receiptId: first.receiptId, secret: first.secret, finalState: kind, finalAt: finalAt.toISOString(), lines, cash });
      }
      for (const sdk of sdks) {
        const r = await sdk.flush();
        if (r.retry || r.rejected > 0) throw new Error(`flush failed: ${JSON.stringify(r)}`);
      }
      created.receipts = missing;
      log(`${missing} receipts created over ${SEED.days} days`);
    }

    // 30 claimed by the buyer: every 6th paid receipt among the ones just created
    const [claimed] = await db.select({ n: count() }).from(tables.claims).where(eq(tables.claims.userId, buyerId));
    let toClaim = SEED.claimedTarget - (claimed?.n ?? 0);
    for (const p of planned.filter((x) => x.finalState === 'paid').filter((_, i) => i % 6 === 5)) {
      if (toClaim <= 0) break;
      await db.insert(tables.claims).values({ receiptId: p.receiptId, userId: buyerId, source: 'qr', claimedAt: new Date(new Date(p.finalAt).getTime() + 60_000) }).onConflictDoNothing();
      toClaim--;
      created.claims++;
    }

    // a second person, so friends, shares and splits have something to show: Sam (the demo buyer) and Anna
    await db.update(tables.users).set({ displayName: 'Sam', handle: 'sam', avatar: '🙂' }).where(and(eq(tables.users.id, buyerId), isNull(tables.users.handle)));
    let [anna] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, SEED.friendEmail));
    if (!anna) [anna] = await db.insert(tables.users).values({ email: SEED.friendEmail, displayName: 'Anna', handle: 'anna', avatar: '🦊' }).returning({ id: tables.users.id });
    const annaId = anna!.id;
    const [pair] = await db
      .select({ id: tables.friendships.id })
      .from(tables.friendships)
      .where(or(and(eq(tables.friendships.requesterId, annaId), eq(tables.friendships.addresseeId, buyerId)), and(eq(tables.friendships.requesterId, buyerId), eq(tables.friendships.addresseeId, annaId))));
    if (!pair) await db.insert(tables.friendships).values({ requesterId: annaId, addresseeId: buyerId, status: 'accepted', respondedAt: now });
    const [hasSplit] = await db.select({ n: count() }).from(tables.splits).where(eq(tables.splits.creatorId, buyerId));
    if ((hasSplit?.n ?? 0) === 0) {
      const [latest] = await db
        .select({ receiptId: tables.claims.receiptId, total: tables.receipts.totalMinor })
        .from(tables.claims)
        .innerJoin(tables.receipts, eq(tables.receipts.id, tables.claims.receiptId))
        .where(eq(tables.claims.userId, buyerId))
        .orderBy(desc(tables.claims.claimedAt))
        .limit(1);
      if (latest) {
        const [split] = await db.insert(tables.splits).values({ receiptId: latest.receiptId, creatorId: buyerId, mode: 'equal', totalMinor: latest.total }).returning({ id: tables.splits.id });
        const [mine, hers] = allocateEqual(latest.total, 2);
        await db.insert(tables.splitShares).values([
          { splitId: split!.id, userId: buyerId, amountMinor: mine!, settledAt: now },
          { splitId: split!.id, userId: annaId, amountMinor: hers! },
        ]);
      }
    }

    const ctx: WorkerCtx = {
      db: workerHandle.db,
      s3: createObjectStore(opts.env),
      extractor: createExtractor(opts.env),
      vapid: null,
      leadThreshold: opts.env.LEAD_THRESHOLD,
      log: () => {},
      now: () => now,
    };

    // uploads from corpus images with the recorded extractor; one matches an official receipt
    const [existingUploads] = await db.select({ n: count() }).from(tables.uploads).where(eq(tables.uploads.userId, buyerId));
    if ((existingUploads?.n ?? 0) < SEED.uploadTarget) {
      const corpus = loadCorpus({ quiet: false });
      const statusOf = (e: CorpusEntry) => {
        const rec = readRecorded(e);
        return rec ? parseExtraction({ markdown: rec.markdown, kie: rec.kie }) : null;
      };
      const withRecording = corpus.entries.filter((e) => statusOf(e) !== null);
      const matchEntry = withRecording.find((e) => e.truth.gross > 0 && (e.truth.merchant.kvk || e.truth.merchant.vatNumber) && statusOf(e)?.status === 'done' && truthPrintedAtUtc(e.truth));
      const reviewEntry = withRecording.find((e) => e !== matchEntry && statusOf(e)?.status === 'needs_review');
      const otherEntry = withRecording.find((e) => e !== matchEntry && e !== reviewEntry && statusOf(e)?.status === 'done');
      const picks = [matchEntry, reviewEntry, otherEntry].filter((e): e is CorpusEntry => e !== undefined);
      if (picks.length < SEED.uploadTarget) throw new Error(`corpus offers only ${picks.length} usable receipts with recordings`);

      if (matchEntry) await seedOfficialReceipt(admin.db, merchantHandle.db, matchEntry, created);

      for (const e of picks) {
        const bytes = new Uint8Array(readFileSync(e.imagePath));
        const uploadId = crypto.randomUUID();
        const key = `uploads/${buyerId}/${uploadId}`;
        await ctx.s3.put(key, bytes, 'image/png');
        await db.insert(tables.uploads).values({ id: uploadId, userId: buyerId, s3Key: key, contentType: 'image/png', status: 'processing' });
        const out = await extractUpload(ctx, { uploadId });
        created.uploads++;
        log(`upload ${e.id}: ${out.status}${out.matchedReceiptId ? ', matches an official receipt' : ''}`);
      }
    }
    // dev DB: show categories and rollups without waiting for the worker's cron
    await categorise(ctx);
    await rollupDaily(ctx, { from: new Date(now.getTime() - (SEED.days + 1) * 86_400_000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) });
    await merchantApi.close();
    return { orgId: org.id, buyerId, created, planned, terminals };
  } finally {
    await workerHandle.close();
    await merchantHandle.close();
    await admin.close();
  }
}

/** The "official" side of an upload match: a second organisation (the corpus merchant) with a paid receipt at the printed time. */
async function seedOfficialReceipt(adminDb: Db, merchantDb: Db, e: CorpusEntry, created: SeedResult['created']): Promise<void> {
  const m = e.truth.merchant;
  const org = await ensureOrg(adminDb, { legalName: `${m.name ?? 'Corpus merchant'} (seed)`, kvk: m.kvk ?? '00000000', vat: m.vatNumber });
  const [has] = await adminDb.select({ n: count() }).from(tables.receipts).where(eq(tables.receipts.orgId, org.id));
  if ((has?.n ?? 0) > 0) return;
  const location = await ensureLocation(adminDb, org.id, m.name ?? 'Corpus merchant', (m.postcode ?? '1000AA').replace(/\s/g, ''));
  const t = await createTerminal(adminDb, { orgId: org.id, locationId: location.id, label: 'Till 1' });
  const api = await buildMerchantApi({ db: merchantDb, boss: { send: async () => null }, claimWindowDays: 90, logLevel: 'warn' });
  const printed = new Date(truthPrintedAtUtc(e.truth)!);
  const sdk = new TerminalSdk({
    apiBase: 'http://merchant-api.local',
    receiptHost: 'http://localhost:3001',
    terminalId: t.terminalId,
    apiKey: t.apiKey,
    privateKey: t.keys.privateKey,
    merchant: { kvkNumber: m.kvk ?? '00000000', vatNumber: m.vatNumber, name: m.name ?? 'Corpus merchant', locationId: location.id },
    store: new MemoryStore(),
    fetch: injectFetch(api),
    now: () => printed,
  });
  await sdk.createReceipt({ state: 'paid', lines: [{ description: 'Boodschappen', qty: 1, unitPrice: e.truth.gross, vatRate: 9 }], payments: [{ method: 'card' }] });
  const r = await sdk.flush();
  await api.close();
  if (r.sent !== 1) throw new Error(`official receipt for ${e.id} was not accepted: ${JSON.stringify(r)}`);
  created.receipts++;
}

if (import.meta.main) {
  const env = loadEnv(workerEnvSchema);
  if (usesDbUrls(env) && !process.argv.includes('--force')) {
    // A hosted pooler allows few connections per user. The seed uses three roles at once, so it must not share them with
    // running apps: stop them first (RUNNING.md, "Run against Supabase"). `--force` skips this check.
    const apps = await runningApps();
    if (apps.length > 0) {
      console.error(`Refusing to seed a hosted database while the apps are running (${apps.join(', ')}). Stop them and run the seed on its own, or pass --force.`);
      process.exit(1);
    }
  }
  const result = await runSeed({ env });
  console.log(
    `seed done: ${result.created.receipts} receipts, ${result.created.claims} claims, ${result.created.uploads} uploads, ${result.created.terminals} terminals created (0 everywhere = already seeded)`,
  );
}
