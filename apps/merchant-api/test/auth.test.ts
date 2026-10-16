import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPair, generateSecret, generateToken, newReceiptId, signBytes } from '@lr/crypto';
import { buildCrf, createReceipt, createWorld, merchantGet, merchantPost, signedBody, sql, submit, type World } from '../../../scripts/lib/testkit.ts';

let w: World;

beforeAll(async () => {
  w = await createWorld();
}, 120_000);
afterAll(async () => {
  await w.close();
});

const failedSignatures = (receiptId?: string) =>
  sql<{ detail: { scope?: string; version?: number }; terminal_id: string; org_id: string; receipt_id: string | null }>(
    w,
    receiptId
      ? "select detail, terminal_id, org_id, receipt_id from ops.audit_log where event = 'failed_signature' and receipt_id = $1"
      : "select detail, terminal_id, org_id, receipt_id from ops.audit_log where event = 'failed_signature' and receipt_id is null",
    receiptId ? [receiptId] : [],
  );

describe('signatures', () => {
  it('an invalid per-version signature → 401 bad_signature + failed_signature audit (receipt id, version)', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const body = { ...signedBody(w.orgA, crf, generateSecret()), signature: signBytes(generateKeyPair().privateKey, new TextEncoder().encode('x')) };
    const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: 'forged-version-1' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'bad_signature' });
    expect(await sql(w, 'select 1 from merchant.receipts where id = $1', [crf.receiptId])).toHaveLength(0);
    const audit = await failedSignatures(crf.receiptId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ terminal_id: w.orgA.terminal.terminalId, org_id: w.orgA.orgId, detail: { version: 1 } });
  });

  it('a payload signed by another terminal (valid signature, wrong key) → 401 + audit', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const body = { version: crf, signature: signedBody(w.orgB, crf).signature, claimSecretHash: signedBody(w.orgA, crf, generateSecret()).claimSecretHash };
    const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: 'foreign-sig-key' });
    expect(res.status).toBe(401);
    expect(await failedSignatures(crf.receiptId)).toHaveLength(1);
  });

  it('a signed payload edited afterwards (amount changed) → 401', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const body = signedBody(w.orgA, crf, generateSecret());
    // keep the arithmetic valid so only the signature can reject it
    const edited = { ...body, version: buildCrf({ receiptId: crf.receiptId, version: 1, state: 'presented', org: w.orgA, createdAt: crf.createdAt, lines: [{ unitPrice: 1, vatRate: 9 }] }) };
    const res = await merchantPost(w.merchant, w.orgA, '/v1/receipts', edited, { idempotencyKey: 'edited-payload-1' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'bad_signature' });
  });

  it('a request whose X-Signature is wrong, missing or from another key → 401 bad_signature + audit failed_signature', async () => {
    const before = (await failedSignatures()).length;
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgA });
    const body = signedBody(w.orgA, crf, generateSecret());
    const wrongKey = await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: 'req-sig-wrong', signWith: generateKeyPair().privateKey });
    const missing = await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: 'req-sig-missing', unsigned: true });
    const otherOrg = await merchantPost(w.merchant, w.orgA, '/v1/receipts', body, { idempotencyKey: 'req-sig-other', signWith: w.orgB.terminal.keys.privateKey });
    for (const r of [wrongKey, missing, otherOrg]) {
      expect(r.status).toBe(401);
      expect(r.body).toMatchObject({ error: 'bad_signature' });
    }
    const audit = await failedSignatures();
    expect(audit.length).toBe(before + 3);
    expect(audit.every((a) => a.detail.scope === 'request' && a.terminal_id === w.orgA.terminal.terminalId)).toBe(true);
    expect(await sql(w, 'select 1 from merchant.receipts where id = $1', [crf.receiptId])).toHaveLength(0);
  });

  it('audit entries for failed signatures contain no receipt content and no secret', async () => {
    const rows = await sql<{ detail: unknown }>(w, "select detail::text t from ops.audit_log where event = 'failed_signature'");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/Koffie|claimSecretHash|secret/i);
  });
});

describe('terminal authentication', () => {
  it('a revoked terminal gets 401 on every endpoint', async () => {
    const org = await w.addOrg();
    const mine = await createReceipt(w, org);
    await w.revoke(org);
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org });
    const post = await submit(w.merchant, org, crf, { secret: generateSecret() });
    const version = await submit(w.merchant, org, buildCrf({ receiptId: mine.receiptId, version: 2, state: 'paid', org }));
    const batch = await merchantPost(w.merchant, org, '/v1/receipts:batch', { items: [{ idempotencyKey: 'revoked-batch-1', body: signedBody(org, crf, generateSecret()) }] });
    const get = await merchantGet(w.merchant, org, `/v1/receipts/${mine.receiptId}`);
    const me = await merchantGet(w.merchant, org, '/v1/terminals/me');
    for (const r of [post, version, batch, get, me]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'unauthorized' });
    }
    expect(await sql(w, 'select 1 from merchant.receipts where id = $1', [crf.receiptId])).toHaveLength(0);
    expect(await sql(w, 'select 1 from merchant.receipt_versions where receipt_id = $1 and version = 2', [mine.receiptId])).toHaveLength(0);
  });

  it('wrong X-Terminal-Id (another terminal, random uuid, missing header) → 401', async () => {
    const withOtherTerminal = await merchantGet(w.merchant, w.orgA, '/v1/terminals/me', { terminalId: w.orgB.terminal.terminalId });
    const withRandom = await merchantGet(w.merchant, w.orgA, '/v1/terminals/me', { terminalId: newReceiptId() });
    const noHeader = await w.merchant.inject({ method: 'GET', url: '/v1/terminals/me', headers: { authorization: `Bearer ${w.orgA.terminal.apiKey}` } });
    expect(withOtherTerminal.status).toBe(401);
    expect(withRandom.status).toBe(401);
    expect(noHeader.statusCode).toBe(401);
    // and the correct pair works
    const ok = await merchantGet(w.merchant, w.orgA, '/v1/terminals/me');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ terminalId: w.orgA.terminal.terminalId, orgId: w.orgA.orgId, locationId: w.orgA.locationId });
  });

  it('wrong or malformed API key → 401', async () => {
    const wrong = await merchantGet(w.merchant, w.orgA, '/v1/terminals/me', { apiKey: generateToken().token });
    const short = await merchantGet(w.merchant, w.orgA, '/v1/terminals/me', { apiKey: 'abc' });
    const none = await w.merchant.inject({ method: 'GET', url: '/v1/terminals/me', headers: { 'x-terminal-id': w.orgA.terminal.terminalId } });
    expect([wrong.status, short.status, none.statusCode]).toEqual([401, 401, 401]);
  });

  it('key of terminal A with the terminal id of B and B’s signature → 401', async () => {
    const crf = buildCrf({ receiptId: newReceiptId(), version: 1, state: 'presented', org: w.orgB });
    const res = await merchantPost(w.merchant, w.orgB, '/v1/receipts', signedBody(w.orgB, crf, generateSecret()), {
      idempotencyKey: 'mixed-credentials',
      apiKey: w.orgA.terminal.apiKey,
    });
    expect(res.status).toBe(401);
  });
});

describe('organisation isolation through the merchant API', () => {
  it('org B cannot GET org A’s receipt (404, not 403: existence is not revealed)', async () => {
    const mine = await createReceipt(w, w.orgA);
    const own = await merchantGet(w.merchant, w.orgA, `/v1/receipts/${mine.receiptId}`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ receipt: { id: mine.receiptId, state: 'presented', currentVersion: 1 }, versions: [{ version: 1 }] });
    const foreign = await merchantGet(w.merchant, w.orgB, `/v1/receipts/${mine.receiptId}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ error: 'not_found' });
    expect((await merchantGet(w.merchant, w.orgB, `/v1/receipts/${newReceiptId()}`)).body).toEqual({ error: 'not_found' });
  });

  it('GET returns no claim secret hash and no buyer data', async () => {
    const mine = await createReceipt(w, w.orgA);
    const res = await merchantGet(w.merchant, w.orgA, `/v1/receipts/${mine.receiptId}`);
    expect(res.text).not.toMatch(/claimSecret|claim_secret|secret|email|user|buyer/i);
  });

  it('org B cannot add a version to org A’s receipt (RLS hides it: version_gap, nothing written)', async () => {
    const mine = await createReceipt(w, w.orgA);
    const res = await submit(w.merchant, w.orgB, buildCrf({ receiptId: mine.receiptId, version: 2, state: 'paid', org: w.orgB }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'version_gap' });
    const [r] = await sql<{ current_version: number }>(w, 'select current_version from merchant.receipts where id = $1', [mine.receiptId]);
    expect(r?.current_version).toBe(1);
  });

  it('org B cannot overwrite or probe org A’s receipt by creating the same receiptId (clean 409, never a 500)', async () => {
    const mine = await createReceipt(w, w.orgA);
    const secret = generateSecret();
    const res = await submit(w.merchant, w.orgB, buildCrf({ receiptId: mine.receiptId, version: 1, state: 'presented', org: w.orgB }), { secret });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'idempotency_conflict' });
    expect((await sql(w, "select 1 from ops.audit_log where event = 'idempotency_conflict' and receipt_id = $1 and org_id = $2", [mine.receiptId, w.orgB.orgId]))).toHaveLength(1);
    const [r] = await sql<{ org_id: string }>(w, 'select org_id from merchant.receipts where id = $1', [mine.receiptId]);
    expect(r?.org_id).toBe(w.orgA.orgId);
    expect(await sql(w, 'select 1 from merchant.receipt_versions where receipt_id = $1', [mine.receiptId])).toHaveLength(1);
  });

  it('a second terminal of the same organisation cannot append to another terminal’s receipt (404)', async () => {
    const mine = await createReceipt(w, w.orgA);
    const second = await w.addTerminal(w.orgA);
    const res = await submit(w.merchant, second, buildCrf({ receiptId: mine.receiptId, version: 2, state: 'paid', org: second }));
    expect(res.status).toBe(404);
  });
});
