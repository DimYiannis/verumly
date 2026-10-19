import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { adminDbUrl } from '@lr/config';
import { getFormat } from '@lr/compliance/formats';
import { generateSecret, hashSecret, newReceiptId, signBytes, signPayload } from '@lr/crypto';
import { connect, tables, type Db, type DbHandle, type PgBoss } from '@lr/db';
import { createTestDb, type TestDb } from '@lr/db/testing';
import { requiredFiscalKeys } from '@lr/fiscal/specs';
import { createLocation, createOrg, createTerminal, revokeTerminal, type ProvisionedTerminal } from '@lr/db/provision';
import { deriveVatSummary, lineTotal } from '@lr/receipt-nl';
import type { Crf, CrfLine } from '@lr/schema';
import { buildApp as buildBuyerApi } from '../../apps/buyer-api/src/app.ts';
import type { AppDeps as BuyerDeps, Mailer } from '../../apps/buyer-api/src/context.ts';
import { buildApp as buildMerchantApi } from '../../apps/merchant-api/src/app.ts';
import { LogCapture } from './harness.ts';

/**
 * Shared fixtures for the real-Postgres integration tests (v2 §16.E/F): a fresh migrated database, two
 * organisations each with a location and a terminal, and both HTTP apps built against role-restricted
 * connections. Requests go through Fastify `inject` (real routing, hooks, validation, RLS, SQL).
 */

export interface OrgFixture {
  orgId: string;
  locationId: string;
  kvk: string;
  vat: string;
  country: string;
  terminal: ProvisionedTerminal;
}

export interface RecordedJob {
  name: string;
  data: object | undefined;
  options: object | undefined;
}

/** A pg-boss stand-in that records what was enqueued (the real queue is exercised by the journey). */
function recordingBoss(sink: RecordedJob[]): Pick<PgBoss, 'send'> {
  return {
    send: async (...args: unknown[]) => {
      const [name, data, options] = args;
      sink.push({
        name: typeof name === 'string' ? name : '',
        data: typeof data === 'object' && data !== null ? data : undefined,
        options: typeof options === 'object' && options !== null ? options : undefined,
      });
      return null;
    },
  };
}

export interface World {
  testDb: TestDb;
  admin: pg.Pool;
  adminDb: Db;
  merchant: FastifyInstance;
  buyer: FastifyInstance;
  logs: LogCapture;
  /** every job the merchant API enqueued */
  jobs: RecordedJob[];
  /** every job the buyer API enqueued */
  buyerJobs: RecordedJob[];
  /** latest login code per email (the stub mailer replaces SMTP) */
  codes: Record<string, string>;
  /** receipt links sent by e-mail ("send it to my e-mail" at the till), newest last */
  receiptMails: Array<{ to: string; merchantName: string; url: string; locale: string }>;
  orgA: OrgFixture;
  orgB: OrgFixture;
  addOrg(opts?: { country?: string }): Promise<OrgFixture>;
  /** a second terminal (own key pair) in the same organisation and location */
  addTerminal(org: OrgFixture): Promise<OrgFixture>;
  /** revoke a terminal as the admin role */
  revoke(org: OrgFixture): Promise<void>;
  close(): Promise<void>;
}

export interface WorldOptions {
  claimWindowDays?: number;
  resolveRatePerMinute?: number;
  /** merged over the buyer API defaults (s3, push settings…) */
  buyerDeps?: Partial<BuyerDeps>;
}

let orgCounter = 0;

export async function createWorld(opts: WorldOptions = {}): Promise<World> {
  const testDb = await createTestDb('it');
  const admin = new pg.Pool({ connectionString: adminDbUrl(testDb.env), max: 6 });
  // `drop database … with (force)` may kill an idle client just before it has said goodbye; that must not crash the run
  admin.on('error', () => {});
  const adminDb = drizzle(admin, { schema: tables });
  const handles: DbHandle[] = [];
  const logs = new LogCapture();
  const jobs: World['jobs'] = [];
  const buyerJobs: World['buyerJobs'] = [];
  const codes: Record<string, string> = {};
  const receiptMails: World['receiptMails'] = [];

  const addOrg: World['addOrg'] = async (o = {}) => {
    const n = ++orgCounter * 7919 + Math.floor(Math.random() * 1000) * 100_003;
    const country = o.country ?? 'NL';
    // ids in the format of the country (NL, DE, FR, GB); other countries get NL-like numbers, which their patterns (or the lack of one) accept
    const eight = String(10_000_000 + (n % 80_000_000));
    const nine = String(100_000_000 + (n % 800_000_000));
    const ids: Record<string, { kvk: string; vat: string }> = {
      DE: { kvk: String(1_000_000_000 + (n % 8_000_000_000)), vat: `DE${nine}` },
      FR: { kvk: String(10_000_000_000_000 + (n % 80_000_000_000_000)), vat: `FR12${nine}` },
      GB: { kvk: `AB${String(100_000 + (n % 800_000))}`, vat: `GB${nine}` },
    };
    const { kvk, vat } = ids[country] ?? { kvk: eight, vat: `NL${nine}B01` };
    const org = await createOrg(adminDb, { legalName: `Org ${kvk}`, kvkNumber: kvk, vatNumber: vat, country });
    const loc = await createLocation(adminDb, org.id, `Location ${kvk}`);
    const terminal = await createTerminal(adminDb, { orgId: org.id, locationId: loc.id, label: `T ${kvk}` });
    return { orgId: org.id, locationId: loc.id, kvk, vat, country, terminal };
  };

  const mh = connect('merchant_api', testDb.env);
  const bh = connect('buyer_api', testDb.env);
  handles.push(mh, bh);
  const merchant = await buildMerchantApi({
    db: mh.db,
    boss: recordingBoss(jobs),
    claimWindowDays: opts.claimWindowDays ?? 90,
    logStream: logs,
  });
  const mailer: Mailer = {
    async sendCode(to, code) {
      codes[to] = code;
    },
    async sendReceipt(to, m) {
      receiptMails.push({ to, ...m });
    },
  };
  const buyer = await buildBuyerApi({
    db: bh.db,
    boss: recordingBoss(buyerJobs),
    mailer,
    allowedOrigin: 'http://localhost:3001',
    logStream: logs,
    resolveRatePerMinute: opts.resolveRatePerMinute,
    ...opts.buyerDeps,
  });

  const orgA = await addOrg();
  const orgB = await addOrg();

  return {
    testDb,
    admin,
    adminDb,
    merchant,
    buyer,
    logs,
    jobs,
    buyerJobs,
    codes,
    receiptMails,
    orgA,
    orgB,
    addOrg,
    async addTerminal(org) {
      return { ...org, terminal: await createTerminal(adminDb, { orgId: org.orgId, locationId: org.locationId, label: `T2 ${org.kvk}` }) };
    },
    revoke: (org) => revokeTerminal(adminDb, org.terminal.terminalId),
    async close() {
      await merchant.close();
      await buyer.close();
      for (const h of handles) await h.close();
      await admin.end();
      await testDb.drop();
    },
  };
}

// ------------------------------------------------------------------ CRF

export interface LineSpec {
  sku?: string | null;
  description?: string;
  qty?: string;
  unitPrice: number;
  vatRate: number | null;
  kind?: CrfLine['kind'];
  discount?: number;
}

export const COFFEE_LINE: LineSpec = { sku: 'KOF', description: 'Koffie', qty: '2', unitPrice: 340, vatRate: 9 };

export interface CrfSpec {
  receiptId: string;
  version: number;
  state: Crf['state'];
  org: OrgFixture;
  lines?: LineSpec[];
  createdAt?: string;
  voidOf?: string | null;
  payments?: Crf['payments'];
}

/** A valid CRF built by hand (not through the SDK) so tests can produce transitions the SDK refuses to sign. */
export function buildCrf(spec: CrfSpec): Crf {
  const format = getFormat(spec.org.country) ?? getFormat('NL')!;
  // the default line is a coffee at the country's reduced rate (9% in NL)
  const coffee: LineSpec = { ...COFFEE_LINE, vatRate: format.vatRates[1] ?? format.vatRates[0]! };
  const lines: CrfLine[] = (spec.lines ?? [coffee]).map((l, i) => {
    const qty = l.qty ?? '1';
    const discount = l.discount ?? 0;
    return {
      lineNo: i + 1,
      kind: l.kind ?? 'item',
      sku: l.sku ?? null,
      description: l.description ?? 'Artikel',
      qty,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      discount,
      total: lineTotal(qty, l.unitPrice, discount),
      category: null,
    };
  });
  const gross = lines.reduce((s, l) => s + l.total, 0);
  const vatSummary = deriveVatSummary(lines);
  const settled = spec.state === 'paid' || spec.state === 'fiscalised';
  return {
    crf: '1',
    receiptId: spec.receiptId,
    version: spec.version,
    state: spec.state,
    merchant: {
      kvkNumber: spec.org.kvk,
      vatNumber: spec.org.vat,
      name: 'Café Het Plein',
      locationId: spec.org.locationId,
      terminalId: spec.org.terminal.terminalId,
    },
    createdAt: spec.createdAt ?? new Date().toISOString(),
    currency: format.currency,
    lines,
    vatSummary,
    totals: { gross, net: vatSummary.reduce((s, v) => s + v.net, 0), vat: vatSummary.reduce((s, v) => s + v.vat, 0), tip: 0, rounding: 0 },
    payments: spec.payments ?? (settled ? [{ method: 'card', amount: gross }] : []),
    fiscal: {
      country: spec.org.country,
      registerSerial: null,
      documentNumber: null,
      // a fiscalised receipt carries the fields of its country's fiscal system
      extra: spec.state === 'fiscalised' ? Object.fromEntries(requiredFiscalKeys(spec.org.country).map((k) => [k, '1'])) : {},
    },
    voidOf: spec.voidOf ?? null,
  };
}

export interface SignedBody {
  version: Crf;
  signature: string;
  claimSecretHash?: string;
}

export function signedBody(org: OrgFixture, crf: Crf, secret?: string): SignedBody {
  return {
    version: crf,
    signature: signPayload(org.terminal.keys.privateKey, crf),
    ...(secret ? { claimSecretHash: hashSecret(secret) } : {}),
  };
}

// ------------------------------------------------------------------ HTTP

export interface HttpResult {
  status: number;
  body: unknown;
  text: string;
}

export interface SendOpts {
  idempotencyKey?: string;
  /** private key used for X-Signature (default: the org's terminal key) */
  signWith?: string;
  apiKey?: string;
  terminalId?: string;
  /** do not send X-Signature at all */
  unsigned?: boolean;
  remoteAddress?: string;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** POST a JSON body to the merchant API as `org`'s terminal, signing the exact raw bytes like the SDK does. */
export async function merchantPost(app: FastifyInstance, org: OrgFixture, path: string, body: unknown, o: SendOpts = {}): Promise<HttpResult> {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await app.inject({
    method: 'POST',
    url: path,
    remoteAddress: o.remoteAddress,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${o.apiKey ?? org.terminal.apiKey}`,
      'x-terminal-id': o.terminalId ?? org.terminal.terminalId,
      ...(o.unsigned ? {} : { 'x-signature': signBytes(o.signWith ?? org.terminal.keys.privateKey, new TextEncoder().encode(text)) }),
      ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}),
    },
    payload: text,
  });
  return { status: res.statusCode, body: parse(res.body), text: res.body };
}

export async function merchantGet(app: FastifyInstance, org: OrgFixture, path: string, o: Pick<SendOpts, 'apiKey' | 'terminalId'> = {}): Promise<HttpResult> {
  const res = await app.inject({
    method: 'GET',
    url: path,
    headers: { authorization: `Bearer ${o.apiKey ?? org.terminal.apiKey}`, 'x-terminal-id': o.terminalId ?? org.terminal.terminalId },
  });
  return { status: res.statusCode, body: parse(res.body), text: res.body };
}

/** Sign and submit one version. Version 1 (with `secret`) is a create, anything else goes to /versions. */
export function submit(app: FastifyInstance, org: OrgFixture, crf: Crf, o: SendOpts & { secret?: string } = {}): Promise<HttpResult> {
  const { secret, ...send } = o;
  const body = signedBody(org, crf, secret);
  const path = secret ? '/v1/receipts' : `/v1/receipts/${crf.receiptId}/versions`;
  return merchantPost(app, org, path, body, { idempotencyKey: `${crf.receiptId}:${crf.version}`, ...send });
}

export interface NewReceipt {
  receiptId: string;
  secret: string;
}

/** Create a receipt at v1 in `state` through the real API. Throws unless the server answers 201. */
export async function createReceipt(
  w: World,
  org: OrgFixture,
  o: { state?: Crf['state']; lines?: LineSpec[]; createdAt?: string } = {},
): Promise<NewReceipt> {
  const receiptId = newReceiptId();
  const secret = generateSecret();
  const crf = buildCrf({ receiptId, version: 1, state: o.state ?? 'presented', org, lines: o.lines, createdAt: o.createdAt });
  const res = await submit(w.merchant, org, crf, { secret });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${res.text}`);
  return { receiptId, secret };
}

export interface BuyerOpts {
  token?: string;
  body?: unknown;
  remoteAddress?: string;
  headers?: Record<string, string>;
}

export async function buyerCall(w: World, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, o: BuyerOpts = {}): Promise<HttpResult> {
  const res = await w.buyer.inject({
    method,
    url,
    remoteAddress: o.remoteAddress,
    headers: { ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...o.headers },
    payload: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  return { status: res.statusCode, body: parse(res.body), text: res.body };
}

export interface BuyerSession {
  email: string;
  token: string;
  userId: string;
}

/** Email-code login against the buyer API (code captured by the stub mailer). */
export async function loginUser(w: World, email = `user-${randomBytes(6).toString('hex')}@example.test`): Promise<BuyerSession> {
  const start = await buyerCall(w, 'POST', '/v1/auth/email/start', { body: { email } });
  if (start.status !== 202) throw new Error(`email start failed: ${start.status} ${start.text}`);
  const code = w.codes[email];
  if (!code) throw new Error('no code captured');
  const verify = await buyerCall(w, 'POST', '/v1/auth/email/verify', { body: { email, code } });
  const b = verify.body;
  if (verify.status !== 200 || typeof b !== 'object' || b === null || !('token' in b) || !('userId' in b) || typeof b.token !== 'string' || typeof b.userId !== 'string') {
    throw new Error(`verify failed: ${verify.status} ${verify.text}`);
  }
  return { email, token: b.token, userId: b.userId };
}

export const claimRequest = (w: World, who: BuyerSession, r: NewReceipt, source: 'qr' | 'link' = 'qr') =>
  buyerCall(w, 'POST', '/v1/me/claims', { token: who.token, body: { receiptId: r.receiptId, secret: r.secret, source } });

export const resolveRequest = (w: World, r: NewReceipt, kind: 'secret' | 'view' = 'secret', remoteAddress?: string) =>
  buyerCall(w, 'POST', `/v1/resolve/${kind}`, { body: { receiptId: r.receiptId, secret: r.secret }, remoteAddress });

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(w: World, text: string, params: unknown[] = []): Promise<T[]> {
  return (await w.admin.query<T>(text, params)).rows;
}

/** A `fetch` that talks to a Fastify app through `inject`, so the terminal SDK can run against a real app without sockets. */
export function injectFetch(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const res = await app.inject({
      method: init?.method === 'GET' ? 'GET' : 'POST',
      url: url.pathname + url.search,
      headers,
      payload: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
  };
}
