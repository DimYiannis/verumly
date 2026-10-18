import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { adminDbUrl } from '@lr/config';
import { connect, tables, type Db, type DbHandle } from '@lr/db';
import { generateKeyPair, hashSecret } from '@lr/crypto';
import { createTerminal as provisionTerminal } from '@lr/db/provision';
import { MemoryStore, TerminalSdk, type Draft } from '@lr/terminal-sdk';

import { createTestDb, type TestDb } from '@lr/db/testing';
import { createLocation, createOrg } from '@lr/db/provision';
import { createMerchantUser, LocalKeyProvider, type Actor, type AuthDeps, type Role } from '../src/index.ts';

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
export const PASSWORD = 'correct horse battery staple';

export interface Fixture {
  testDb: TestDb;
  admin: Db;
  adminPool: pg.Pool;
  dash: DbHandle;
  deps: AuthDeps;
  /** 0 and 1 are Dutch; 2 is German (needs the fiscal step), 3 is French (decimal VAT rates) */
  orgs: Array<{ id: string; locationId: string; kvk: string; country: string }>;
  close(): Promise<void>;
}

/** Fresh migrated database with four organisations (NL, NL, DE, FR), each with one location. Everything runs as the `dashboard` role. */
export async function fixture(prefix: string): Promise<Fixture> {
  const testDb = await createTestDb(prefix);
  const adminPool = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 3 });
  // `drop database … with (force)` may kill an idle client just before it has said goodbye; that must not crash the run
  adminPool.on('error', () => {});
  const admin = drizzle(adminPool) as unknown as Db;
  const orgs = [];
  const specs = [
    { kvk: '12345678', vat: 'NL123456780B01', country: 'NL' },
    { kvk: '87654321', vat: 'NL123456781B01', country: 'NL' },
    { kvk: '1234567890', vat: 'DE123456789', country: 'DE' },
    { kvk: '12345678901234', vat: 'FR12123456789', country: 'FR' },
  ];
  for (const [i, s] of specs.entries()) {
    const org = await createOrg(admin, { legalName: `Org ${i}`, kvkNumber: s.kvk, vatNumber: s.vat, country: s.country });
    const loc = await createLocation(admin, org.id, `Loc ${i}`);
    orgs.push({ id: org.id, locationId: loc.id, kvk: s.kvk, country: s.country });
  }
  const dash = connect('dashboard', testDb.env);
  return {
    testDb,
    admin,
    adminPool,
    dash,
    deps: { db: dash.db, keys: new LocalKeyProvider(TEST_KEY) },
    orgs,
    async close() {
      await dash.close();
      await adminPool.end();
      await testDb.drop();
    },
  };
}

let userSeq = 0;
export async function userWithRole(f: Fixture, orgIndex: number, role: Role, email = `${role}-${orgIndex}-${++userSeq}@example.test`): Promise<{ actor: Actor; email: string }> {
  const org = f.orgs[orgIndex]!;
  const u = await createMerchantUser(f.admin, { orgId: org.id, email, password: PASSWORD, role });
  return { actor: { userId: u.id, orgId: org.id, role }, email };
}

// ------------------------------------------------------------------ receipts via the real SDK, inserted as the admin


export const KOFFIE = { description: 'Koffie', unitPrice: 340, vatRate: 9 as const };
export const TAART = { description: 'Appeltaart', unitPrice: 395, vatRate: 9 as const };
export const BIER = { description: 'Bier', unitPrice: 389, vatRate: 21 as const };
export const WIJN = { description: 'Wijn', unitPrice: 495, vatRate: 21 as const };

export interface SaleSpec {
  /** terminal clock for the first version (ISO UTC); later versions are +1 min each */
  at: string;
  lines: Array<{ description: string; unitPrice: number; vatRate: number; qty?: number }>;
  steps: Array<'present' | 'pay-card' | 'pay-cash' | 'void'>;
}


export async function seedTerminal(f: Fixture, orgIndex: number): Promise<{ terminalId: string; privateKey: string }> {
  const org = f.orgs[orgIndex]!;
  const keys = generateKeyPair();
  const t = await provisionTerminal(f.admin, { orgId: org.id, locationId: org.locationId, label: 'Kassa', keys });
  return { terminalId: t.terminalId, privateKey: keys.privateKey };
}

/** Builds each sale with the real terminal SDK (so CRFs, BTW and rounding are the real ones) and inserts it as the owner. */
export async function seedSales(f: Fixture, orgIndex: number, terminal: { terminalId: string; privateKey: string }, sales: SaleSpec[]): Promise<string[]> {
  const org = f.orgs[orgIndex]!;
  const ids: string[] = [];
  for (const sale of sales) {
    let clock = new Date(sale.at).getTime();
    const store = new MemoryStore();
    const sdk = new TerminalSdk({
      apiBase: 'http://invalid.test',
      receiptHost: 'http://localhost:3001',
      terminalId: terminal.terminalId,
      apiKey: 'unused',
      privateKey: terminal.privateKey,
      merchant: { kvkNumber: org.kvk, vatNumber: null, name: `Org ${orgIndex}`, locationId: org.locationId },
      country: org.country,
      store,
      now: () => new Date((clock += 60_000) - 60_000),
    });
    const lines = sale.lines.map((l) => ({ ...l, qty: l.qty ?? 1 }));
    let receiptId = '';
    let secret = '';
    for (const [i, step] of sale.steps.entries()) {
      const draft: Draft = step === 'present' ? { state: 'presented', lines } : { state: 'paid', lines, payments: [{ method: step === 'pay-cash' ? 'cash' : 'card' }] };
      if (i === 0) ({ receiptId, secret } = await sdk.createReceipt(step === 'void' ? { state: 'paid', lines } : draft));
      else if (step === 'void') await sdk.voidReceipt(receiptId);
      else await sdk.addVersion(receiptId, draft);
    }
    const items = await store.pending(100);
    const last = items[items.length - 1]!.body.version;
    await f.admin.insert(tables.receipts).values({
      id: receiptId,
      orgId: org.id,
      locationId: org.locationId,
      terminalId: terminal.terminalId,
      state: last.state,
      currentVersion: last.version,
      claimSecretHash: hashSecret(secret),
      totalMinor: last.totals.gross,
      createdOnTerminalAt: new Date(items[0]!.body.version.createdAt),
      claimableUntil: new Date(Date.now() + 90 * 86400_000),
    });
    for (const it of items) {
      await f.admin.insert(tables.receiptVersions).values({
        receiptId,
        orgId: org.id,
        version: it.body.version.version,
        state: it.body.version.state,
        payload: it.body.version,
        signature: it.body.signature,
        createdOnTerminalAt: new Date(it.body.version.createdAt),
      });
    }
    await f.admin.insert(tables.receiptLines).values(
      last.lines.map((l) => ({ receiptId, orgId: org.id, lineNo: l.lineNo, kind: l.kind, sku: l.sku, description: l.description, qty: l.qty, unitPriceMinor: l.unitPrice, vatRate: l.vatRate, totalMinor: l.total })),
    );
    ids.push(receiptId);
  }
  return ids;
}
