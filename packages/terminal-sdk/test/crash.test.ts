import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, sql, type OrgFixture, type World } from '../../../scripts/lib/testkit.ts';
import { TerminalSdk } from '../src/index.ts';
import { SqliteStore } from '../src/sqlite-store.ts';

/**
 * Crash test (v2 §16.F): a real child process runs the SDK flusher with a SQLite outbox against a real merchant API over HTTP and
 * is killed with SIGKILL at awkward moments. After restarting it, the server must hold every (receiptId, version) exactly once, in
 * order, with no gaps, and the outbox must end empty.
 */

const CHILD = fileURLToPath(new URL('./crash-child.ts', import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let w: World;
let apiBase = '';
const ctl = {
  batchRequests: 0,
  delayMs: 0,
  killOnRequest: 0,
  killOnResponse: 0,
  target: undefined as ChildProcess | undefined,
};

beforeAll(async () => {
  w = await createWorld();
  w.merchant.addHook('onRequest', async (req) => {
    if (req.method !== 'POST' || !req.url.endsWith('batch')) return;
    ctl.batchRequests++;
    if (ctl.killOnRequest && ctl.batchRequests === ctl.killOnRequest) ctl.target?.kill('SIGKILL');
    if (ctl.delayMs) await sleep(ctl.delayMs);
  });
  w.merchant.addHook('onResponse', async (req) => {
    if (req.method === 'POST' && req.url.endsWith('batch') && ctl.killOnResponse && ctl.batchRequests === ctl.killOnResponse) ctl.target?.kill('SIGKILL');
  });
  await w.merchant.listen({ port: 0, host: '127.0.0.1' });
  const addr = w.merchant.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  apiBase = `http://127.0.0.1:${addr.port}`;
}, 120_000);

afterAll(async () => {
  await w.close();
});

const dirs: string[] = [];
afterEach(() => {
  ctl.batchRequests = 0;
  ctl.delayMs = 0;
  ctl.killOnRequest = 0;
  ctl.killOnResponse = 0;
  ctl.target = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const outboxFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lr-crash-'));
  dirs.push(dir);
  return join(dir, 'outbox.db');
};

interface Run {
  child: ChildProcess;
  lines: string[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function spawnChild(org: OrgFixture, file: string, mode: 'flush' | 'enqueue', batch = 20): Run {
  const child = spawn(process.execPath, [CHILD], {
    env: {
      ...process.env,
      LR_MODE: mode,
      LR_FILE: file,
      LR_BATCH: String(batch),
      LR_API_BASE: apiBase,
      LR_TERMINAL_ID: org.terminal.terminalId,
      LR_API_KEY: org.terminal.apiKey,
      LR_PRIVATE_KEY: org.terminal.keys.privateKey,
      LR_KVK: org.kvk,
      LR_VAT: org.vat,
      LR_LOCATION_ID: org.locationId,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines: string[] = [];
  let partial = '';
  child.stdout?.on('data', (d: Buffer) => {
    partial += d.toString();
    const parts = partial.split('\n');
    partial = parts.pop() ?? '';
    lines.push(...parts);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, lines, exited };
}

function sdkFor(org: OrgFixture, store: SqliteStore, batchSize = 500): TerminalSdk {
  return new TerminalSdk({
    apiBase,
    receiptHost: 'https://receipts.example',
    terminalId: org.terminal.terminalId,
    apiKey: org.terminal.apiKey,
    privateKey: org.terminal.keys.privateKey,
    merchant: { kvkNumber: org.kvk, vatNumber: org.vat, name: 'Café Het Plein', locationId: org.locationId },
    store,
    batchSize,
    random: () => 0.5,
  });
}

interface Plan {
  /** receiptId → number of versions queued */
  versions: Record<string, number>;
  /** `receiptId:version` in outbox (commit) order */
  order: string[];
}

/** Queue `n` receipts with 1–4 versions each into the SQLite outbox at `file`, in-process, while "offline". */
async function enqueue(org: OrgFixture, file: string, n: number): Promise<Plan> {
  const store = new SqliteStore(file);
  const sdk = sdkFor(org, store);
  const plan: Plan = { versions: {}, order: [] };
  for (let i = 0; i < n; i++) {
    const count = (i % 4) + 1;
    const { receiptId } = await sdk.createReceipt({ state: 'presented', lines: [{ description: 'Koffie', unitPrice: 340, vatRate: 9, qty: 2 }] });
    plan.order.push(`${receiptId}:1`);
    for (let v = 2; v <= count; v++) {
      await sdk.addVersion(receiptId, { state: v === count ? 'paid' : 'presented' });
      plan.order.push(`${receiptId}:${v}`);
    }
    plan.versions[receiptId] = count;
  }
  store.close();
  return plan;
}

/** Wait until the server stopped writing (a killed client's batch may still be running server-side). */
async function settle(org: OrgFixture): Promise<number> {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 200 && stable < 5; i++) {
    const [row] = await sql<{ n: number }>(w, 'select count(*)::int n from merchant.receipt_versions where org_id = $1', [org.orgId]);
    const n = row?.n ?? 0;
    stable = n === last ? stable + 1 : 0;
    last = n;
    await sleep(80);
  }
  return last;
}

async function pendingInOutbox(file: string): Promise<string[]> {
  const s = new SqliteStore(file);
  const items = await s.pending(100_000);
  s.close();
  return items.map((i) => `${i.receiptId}:${i.version}`);
}

async function assertExactlyOnceInOrder(org: OrgFixture, plan: Plan, file: string, opts: { globalOrder: boolean }) {
  const total = Object.values(plan.versions).reduce((a, b) => a + b, 0);
  const rows = await sql<{ receipt_id: string; version: number; received_at: Date }>(
    w,
    'select receipt_id, version, received_at from merchant.receipt_versions where org_id = $1 order by received_at, version',
    [org.orgId],
  );
  expect(rows).toHaveLength(total); // the primary key makes duplicates impossible; the count proves nothing is missing
  for (const [id, n] of Object.entries(plan.versions)) {
    const mine = rows.filter((r) => r.receipt_id === id).sort((a, b) => a.version - b.version);
    expect(mine.map((r) => r.version), `versions of ${id}`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    for (let i = 1; i < mine.length; i++) expect(mine[i]!.received_at.getTime()).toBeGreaterThanOrEqual(mine[i - 1]!.received_at.getTime());
  }
  if (opts.globalOrder) expect(rows.map((r) => `${r.receipt_id}:${r.version}`)).toEqual(plan.order);

  const receipts = await sql<{ id: string; current_version: number }>(w, 'select id, current_version from merchant.receipts where org_id = $1', [org.orgId]);
  expect(Object.fromEntries(receipts.map((r) => [r.id, r.current_version]))).toEqual(plan.versions);
  expect(await sql(w, 'select 1 from ops.idempotency_keys where terminal_id = $1', [org.terminal.terminalId])).toHaveLength(total);
  expect(await sql(w, "select 1 from ops.audit_log where org_id = $1 and event in ('idempotency_conflict','failed_signature')", [org.orgId])).toHaveLength(0);

  const outbox = new SqliteStore(file);
  expect(await outbox.stats()).toEqual({ pending: 0, rejected: 0 });
  outbox.close();
}

describe('crash test: kill -9 the flusher mid-batch, restart, exactly once and in order', () => {
  it('killed when the 2nd batch request arrives (the server finishes the batch, the client never sees the acknowledgement)', async () => {
    const org = await w.addOrg();
    const file = outboxFile();
    const plan = await enqueue(org, file, 40);
    const total = plan.order.length;
    expect(total).toBeGreaterThan(60);

    ctl.killOnRequest = 2;
    const first = spawnChild(org, file, 'flush');
    ctl.target = first.child;
    expect((await first.exited).signal).toBe('SIGKILL');
    const stored = await settle(org);

    // the interesting window was really hit: the server holds versions the dead client still has queued
    const stillQueued = await pendingInOutbox(file);
    const serverHas = new Set(
      (await sql<{ receipt_id: string; version: number }>(w, 'select receipt_id, version from merchant.receipt_versions where org_id = $1', [org.orgId])).map((r) => `${r.receipt_id}:${r.version}`),
    );
    const storedButUnacked = stillQueued.filter((k) => serverHas.has(k));
    expect(storedButUnacked.length).toBeGreaterThan(0);
    expect(stored).toBe(40); // batches 1 and 2 of 20 items
    expect(stillQueued.length).toBe(total - 20); // only batch 1 was acknowledged and removed

    ctl.killOnRequest = 0;
    const second = spawnChild(org, file, 'flush');
    expect(await second.exited).toEqual({ code: 0, signal: null });
    expect(second.lines.at(-1)).toBe('flushed pending=0 rejected=0');
    await assertExactlyOnceInOrder(org, plan, file, { globalOrder: true });
  }, 120_000);

  it('killed right after the server answered the 3rd batch (acknowledged on the wire, maybe never removed from the outbox)', async () => {
    const org = await w.addOrg();
    const file = outboxFile();
    const plan = await enqueue(org, file, 40);

    ctl.killOnResponse = 3;
    const first = spawnChild(org, file, 'flush');
    ctl.target = first.child;
    expect((await first.exited).signal).toBe('SIGKILL');
    await settle(org);
    expect((await pendingInOutbox(file)).length).toBeGreaterThan(0);

    ctl.killOnResponse = 0;
    const second = spawnChild(org, file, 'flush');
    expect(await second.exited).toEqual({ code: 0, signal: null });
    await assertExactlyOnceInOrder(org, plan, file, { globalOrder: true });
  }, 120_000);

  it('killed again and again at arbitrary moments with a slow server, restarted straight away (overlapping the dead client’s in-flight batch)', async () => {
    const org = await w.addOrg();
    const file = outboxFile();
    const plan = await enqueue(org, file, 60);
    ctl.delayMs = 60;

    let kills = 0;
    for (const lifetime of [450, 300, 700, 380]) {
      const run = spawnChild(org, file, 'flush', 10);
      ctl.target = run.child;
      await sleep(lifetime);
      const before = await pendingInOutbox(file);
      run.child.kill('SIGKILL');
      const { signal } = await run.exited;
      if (signal === 'SIGKILL' && before.length > 0) kills++;
      // no settle(): the next process starts while the server may still be working on the dead one's batch
    }
    expect(kills).toBeGreaterThanOrEqual(3);

    ctl.delayMs = 0;
    const last = spawnChild(org, file, 'flush', 10);
    expect(await last.exited).toEqual({ code: 0, signal: null });
    await settle(org);
    // across overlapping processes the global arrival order across receipts is not an invariant; per-receipt order is
    await assertExactlyOnceInOrder(org, plan, file, { globalOrder: false });
  }, 120_000);

  it('killed while still queueing (mid-commit): the outbox is intact and consistent, and everything printed as committed survived', async () => {
    const org = await w.addOrg();
    const file = outboxFile();
    const run = spawnChild(org, file, 'enqueue');
    for (let i = 0; i < 400 && run.lines.length < 40; i++) await sleep(50);
    expect(run.lines.length).toBeGreaterThanOrEqual(40);
    run.child.kill('SIGKILL');
    expect((await run.exited).signal).toBe('SIGKILL');

    const store = new SqliteStore(file);
    const pending = await store.pending(100_000);
    const byReceipt: Record<string, number[]> = {};
    for (const p of pending) (byReceipt[p.receiptId] ??= []).push(p.version);
    // every line the child printed after a commit returned is durable
    for (const line of run.lines) {
      const [, id, v] = line.split(' ');
      expect(byReceipt[id!], `${line} lost`).toContain(Number(v));
    }
    // atomic commit: the stored receipt state always equals the newest queued version, and versions are contiguous from 1
    for (const [id, versions] of Object.entries(byReceipt)) {
      expect(versions).toEqual(Array.from({ length: versions.length }, (_, i) => i + 1));
      expect((await store.getReceipt(id))?.crf.version).toBe(versions.length);
    }
    const plan: Plan = { versions: Object.fromEntries(Object.entries(byReceipt).map(([id, v]) => [id, v.length])), order: pending.map((p) => `${p.receiptId}:${p.version}`) };

    // the surviving queue delivers cleanly
    expect(await sdkFor(org, store).flush()).toMatchObject({ rejected: 0, retry: false });
    store.close();
    await assertExactlyOnceInOrder(org, plan, file, { globalOrder: true });
  }, 120_000);
});
