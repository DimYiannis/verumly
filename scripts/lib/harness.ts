import { createServer } from 'node:net';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { connect, makeBoss, tables, type DbHandle, type PgBoss } from '@lr/db';
import { createTestDb, type TestDb } from '@lr/db/testing';
import { createLocation, createOrg, createTerminal, type ProvisionedTerminal } from '@lr/db/provision';
import { adminDbUrl } from '@lr/config';
import { buildApp as buildMerchantApi } from '../../apps/merchant-api/src/app.ts';
import { buildApp as buildBuyerApi } from '../../apps/buyer-api/src/app.ts';
import { smtpMailer } from '../../apps/buyer-api/src/mail.ts';
import pg from 'pg';

export const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025';

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      s.close(() => (addr && typeof addr === 'object' ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

/** Collects every log line written by the services in this process (privacy canary). */
export class LogCapture extends Writable {
  lines: string[] = [];
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
    this.lines.push(chunk.toString());
    cb();
  }
}

export interface Stack {
  testDb: TestDb;
  admin: pg.Pool;
  logs: LogCapture;
  merchantPort: number;
  buyerPort: number;
  merchantUrl: string;
  buyerUrl: string;
  org: { id: string; kvk: string; vat: string };
  location: { id: string };
  terminal: ProvisionedTerminal;
  /** start/stop merchant-api independently to simulate an outage */
  startMerchantApi(): Promise<void>;
  startBuyerApi(): Promise<void>;
  stopAll(): Promise<void>;
  boss: PgBoss;
}

export async function startStack(opts: { startMerchant?: boolean; claimWindowDays?: number } = {}): Promise<Stack> {
  const testDb = await createTestDb('journey');
  const admin = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 4 });
  const adminDb = drizzle(admin, { schema: tables });
  const org = await createOrg(adminDb, { legalName: 'Café Het Plein B.V.', kvkNumber: '12345678', vatNumber: 'NL123456789B01' });
  const loc = await createLocation(adminDb, org.id, 'Café Het Plein');
  const terminal = await createTerminal(adminDb, { orgId: org.id, locationId: loc.id, label: 'Till 1' });

  const logs = new LogCapture();
  const merchantPort = await freePort();
  const buyerPort = await freePort();
  const handles: DbHandle[] = [];
  const apps: FastifyInstance[] = [];
  const bosses: PgBoss[] = [];

  const stack: Stack = {
    testDb,
    admin,
    logs,
    merchantPort,
    buyerPort,
    merchantUrl: `http://127.0.0.1:${merchantPort}`,
    buyerUrl: `http://127.0.0.1:${buyerPort}`,
    org: { id: org.id, kvk: '12345678', vat: 'NL123456789B01' },
    location: { id: loc.id },
    terminal,
    boss: undefined as unknown as PgBoss,
    async startMerchantApi() {
      const h = connect('merchant_api', testDb.env);
      handles.push(h);
      const boss = makeBoss('merchant_api', testDb.env);
      await boss.start();
      bosses.push(boss);
      const app = await buildMerchantApi({ db: h.db, boss, claimWindowDays: opts.claimWindowDays ?? 90, logStream: logs });
      await app.listen({ port: merchantPort, host: '127.0.0.1' });
      apps.push(app);
    },
    async startBuyerApi() {
      const h = connect('buyer_api', testDb.env);
      handles.push(h);
      const boss = makeBoss('buyer_api', testDb.env);
      await boss.start();
      bosses.push(boss);
      const app = await buildBuyerApi({
        db: h.db,
        boss,
        mailer: smtpMailer({ host: '127.0.0.1', port: 1025, from: 'Receipts <no-reply@receipts.test>' }),
        allowedOrigin: 'http://localhost:3001',
        logStream: logs,
      });
      await app.listen({ port: buyerPort, host: '127.0.0.1' });
      apps.push(app);
    },
    async stopAll() {
      for (const a of apps) await a.close();
      for (const b of bosses) await b.stop({ graceful: false });
      for (const h of handles) await h.close();
      await admin.end();
      await testDb.drop();
    },
  };
  if (opts.startMerchant) await stack.startMerchantApi();
  await stack.startBuyerApi();
  return stack;
}

/** Fetch the 6-digit login code Mailpit received for `email`. */
export async function mailpitCode(email: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const json: unknown = await res.json();
    const messages = typeof json === 'object' && json !== null && 'messages' in json && Array.isArray(json.messages) ? json.messages : [];
    const subject: unknown = messages[0]?.Subject;
    if (typeof subject === 'string') {
      const m = /(\d{6})/.exec(subject);
      if (m) return m[1]!;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no mail for ${email} within ${timeoutMs}ms`);
}

export async function deleteMailFor(email: string): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { method: 'DELETE' });
}
