import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { adminDbUrl } from '@lr/config';
import { ensureDatabase, migrate } from '@lr/db/migrate';
import { dbEnv, URLS } from './support/env.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const READY_TIMEOUT_MS = 300_000;

interface Probe {
  name: string;
  listening: boolean;
  ready: boolean;
  detail: string;
}

async function get(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
}

async function workerConnected(): Promise<boolean> {
  const c = new pg.Client({ connectionString: adminDbUrl(dbEnv) });
  try {
    await c.connect();
    const r = await c.query('select count(*)::int as n from pg_stat_activity where usename = $1 and datname = $2', ['worker', dbEnv.PG_DATABASE]);
    return (r.rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}

async function probeAll(): Promise<Probe[]> {
  const [merchantApi, buyerApi, merchantWeb, wallet, sw, worker] = await Promise.all([
    get(`${URLS.merchantApi}/healthz`),
    get(`${URLS.buyerApi}/healthz`),
    get(`${URLS.merchantWeb}/dashboard/login`),
    get(`${URLS.wallet}/`),
    get(`${URLS.wallet}/sw.js`),
    workerConnected(),
  ]);
  const swIsScript = sw?.ok === true && (sw.headers.get('content-type') ?? '').includes('javascript');
  return [
    { name: 'merchant-api :4001', listening: merchantApi !== null, ready: merchantApi?.ok === true, detail: '/healthz' },
    { name: 'buyer-api :4002', listening: buyerApi !== null, ready: buyerApi?.ok === true, detail: '/healthz' },
    { name: 'merchant-web :3000', listening: merchantWeb !== null, ready: merchantWeb?.ok === true, detail: '/dashboard/login' },
    {
      name: 'wallet :3001',
      listening: wallet !== null,
      ready: wallet?.ok === true && swIsScript,
      detail: 'must serve /sw.js (the built PWA: `pnpm dev` builds it; `pnpm --filter @lr/wallet dev:hmr` has no service worker)',
    },
    { name: 'worker', listening: worker, ready: worker, detail: `no connection as role "worker" on database ${dbEnv.PG_DATABASE}` },
  ];
}

/** First request to each Nuxt dev page compiles it; do that now so no test pays for it. */
async function warmUp(): Promise<void> {
  for (const path of ['/dashboard/login', '/dashboard', '/dashboard/terminals', '/dashboard/archive', '/dashboard/billing', '/billing/checkout/00000000-0000-4000-8000-000000000000', '/simulator']) await get(`${URLS.merchantWeb}${path}`);
  for (const path of ['/', '/login', '/r/00000000-0000-0000-0000-000000000000']) await get(`${URLS.wallet}${path}`);
}

async function stop(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  process.kill(-pid, 'SIGTERM');
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, 20_000);
  await exited;
  clearTimeout(timer);
}

/**
 * Makes sure the whole dev stack (`pnpm dev` = turbo run dev --parallel: merchant-api, buyer-api, worker, merchant-web, wallet)
 * is up. A stack that is already running is reused as it is. If nothing listens, the database is created and migrated
 * (PG_DATABASE selects it; the default is the dev database) and `pnpm dev` is started and stopped again afterwards.
 */
export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  let probes = await probeAll();
  let started: ChildProcess | undefined;

  if (!probes.some((p) => p.listening)) {
    await ensureDatabase(dbEnv, dbEnv.PG_DATABASE);
    await migrate(dbEnv);
    mkdirSync(`${root}.local`, { recursive: true });
    const log = openSync(`${root}.local/e2e-pnpm-dev.log`, 'w');
    started = spawn('pnpm', ['dev', '--env-mode=loose'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', log, log],
      // EXTRACTOR=recorded and PUSH_ALLOW_LOOPBACK=true are also the app defaults outside production; set explicitly for the record.
      // DEMO_MODE=false keeps the TOTP flow covered; the Billing page's "Simulate renewal now" (which follows DEMO_MODE) is turned on separately
      env: { ...process.env, EXTRACTOR: 'recorded', PUSH_ALLOW_LOOPBACK: 'true', DEMO_MODE: 'false', BILLING_SIMULATE_RENEWAL: 'true' },
    });
    closeSync(log);
    console.log(`e2e: started \`pnpm dev\` (pid ${started.pid}), log .local/e2e-pnpm-dev.log`);
  } else {
    console.log('e2e: reusing the running dev stack');
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    probes = await probeAll();
    if (probes.every((p) => p.ready)) break;
    if (Date.now() > deadline) {
      if (started) await stop(started);
      const missing = probes.filter((p) => !p.ready).map((p) => `${p.name} (${p.detail})`);
      throw new Error(`dev stack not ready after ${READY_TIMEOUT_MS / 1000}s: ${missing.join('; ')}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  await warmUp();

  if (!started) return undefined;
  const child = started;
  return () => stop(child);
}
