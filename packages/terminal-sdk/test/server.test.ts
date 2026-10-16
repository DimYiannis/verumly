import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCrf, buyerCall, claimRequest, createWorld, injectFetch, loginUser, resolveRequest, sql, submit, type OrgFixture, type World } from '../../../scripts/lib/testkit.ts';
import { MemoryStore, TerminalSdk, type OutboxStore } from '../src/index.ts';
import { simpleDraft } from './support.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld({ resolveRatePerMinute: 10_000 });
}, 120_000);
afterAll(async () => {
  await w.close();
});

function sdkForOrg(org: OrgFixture, store: OutboxStore, fetchImpl: typeof fetch = injectFetch(w.merchant)): TerminalSdk {
  return new TerminalSdk({
    apiBase: 'http://merchant.test',
    receiptHost: 'https://receipts.example',
    terminalId: org.terminal.terminalId,
    apiKey: org.terminal.apiKey,
    privateKey: org.terminal.keys.privateKey,
    merchant: { kvkNumber: org.kvk, vatNumber: org.vat, name: 'Café Het Plein', locationId: org.locationId },
    store,
    fetch: fetchImpl,
    random: () => 0.5,
  });
}

const stored = (receiptId: string) =>
  sql<{ version: number }>(w, 'select version from merchant.receipt_versions where receipt_id = $1 order by version', [receiptId]).then((r) => r.map((x) => x.version));

describe('SDK against the real merchant API', () => {
  it('createReceipt returns the QR URL before any network call', async () => {
    const sdk = sdkForOrg(w.orgA, new MemoryStore(), () => {
      throw new Error('network must not be touched');
    });
    const { receiptId, secret, qrUrl } = await sdk.createReceipt(simpleDraft);
    expect(qrUrl).toBe(`https://receipts.example/r/${receiptId}#${secret}`);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sdk.qrSvg(qrUrl)).toContain('<svg');
  });

  it('a mixed queue goes out as ONE batch and the server stores every version in order', async () => {
    const store = new MemoryStore();
    const sdk = sdkForOrg(w.orgA, store);
    const a = (await sdk.createReceipt(simpleDraft)).receiptId;
    const b = (await sdk.createReceipt(simpleDraft)).receiptId;
    await sdk.addVersion(a, { state: 'presented' });
    await sdk.addVersion(a, { state: 'paid' });
    await sdk.voidReceipt(b);
    expect(await sdk.flush()).toEqual({ sent: 5, rejected: 0, retry: false });
    expect(await stored(a)).toEqual([1, 2, 3]);
    expect(await stored(b)).toEqual([1, 2]);
    expect(await store.stats()).toEqual({ pending: 0, rejected: 0 });
  });

  it('uploading the same queue twice (restored backup, lost acks) does not duplicate anything', async () => {
    const first = new MemoryStore();
    const sdk = sdkForOrg(w.orgA, first);
    const id = (await sdk.createReceipt(simpleDraft)).receiptId;
    await sdk.addVersion(id, { state: 'paid' });
    const copy = await first.pending(10); // snapshot of the queue before it is acknowledged
    await sdk.flush();
    const restored = new MemoryStore();
    const receipt = (await first.getReceipt(id))!;
    for (const item of copy) {
      const { seq: _s, ...rest } = item;
      await restored.commit(receipt, rest);
    }
    expect(await sdkForOrg(w.orgA, restored).flush()).toEqual({ sent: 2, rejected: 0, retry: false });
    expect(await stored(id)).toEqual([1, 2]);
  });
});

describe('threat: versions signed offline before the terminal key was revoked', () => {
  it('queued versions of a revoked terminal are rejected with 401 and dead-lettered (single-upload path)', async () => {
    const org = await w.addOrg();
    const store = new MemoryStore();
    const sdk = sdkForOrg(org, store);
    const { receiptId } = await sdk.createReceipt(simpleDraft); // signed offline, before the revoke
    await w.revoke(org);
    expect(await sdk.flush()).toEqual({ sent: 0, rejected: 1, retry: false });
    expect(await store.stats()).toEqual({ pending: 0, rejected: 1 });
    expect(await stored(receiptId)).toEqual([]);
  });

  it('…and through the batch path: the whole queue is refused with 401, dead-lettered, and never blocks later items', async () => {
    const org = await w.addOrg();
    const store = new MemoryStore();
    const sdk = sdkForOrg(org, store);
    const ids = [(await sdk.createReceipt(simpleDraft)).receiptId, (await sdk.createReceipt(simpleDraft)).receiptId];
    await sdk.addVersion(ids[0]!, { state: 'paid' });
    await w.revoke(org);
    const r = await sdk.flush();
    expect(r).toMatchObject({ sent: 0, rejected: 3, retry: false });
    expect(await store.stats()).toEqual({ pending: 0, rejected: 3 });
    for (const id of ids) expect(await stored(id)).toEqual([]);
  });

  it('versions the server had already accepted stay (revocation is not retroactive); the later offline ones are refused, so the receipt stays at its last accepted version', async () => {
    const org = await w.addOrg();
    const store = new MemoryStore();
    const sdk = sdkForOrg(org, store);
    const { receiptId, secret } = await sdk.createReceipt(simpleDraft);
    expect(await sdk.flush()).toMatchObject({ sent: 1 });
    const buyer = await loginUser(w);
    expect((await claimRequest(w, buyer, { receiptId, secret })).status).toBe(201);

    await sdk.addVersion(receiptId, { state: 'paid' }); // offline
    await w.revoke(org);
    expect(await sdk.flush()).toMatchObject({ sent: 0, rejected: 1 });

    expect(await stored(receiptId)).toEqual([1]);
    // the claimed receipt never becomes final: the buyer keeps seeing the presented pre-bill
    const detail = await buyerCall(w, 'GET', `/v1/me/receipts/${receiptId}`, { token: buyer.token });
    expect(detail.body).toMatchObject({ final: false, receipt: { state: 'presented', version: 1 } });
    expect((await resolveRequest(w, { receiptId, secret })).body).toMatchObject({ preview: { state: 'presented' } });
  });

  it('a replacement terminal in the same organisation cannot take over the stranded receipt: 404, the receipt stays at its last version', async () => {
    const org = await w.addOrg();
    const sdk = sdkForOrg(org, new MemoryStore());
    const { receiptId } = await sdk.createReceipt(simpleDraft);
    await sdk.flush();
    await w.revoke(org);
    const replacement = await w.addTerminal(org);
    const res = await submit(w.merchant, replacement, buildCrf({ receiptId, version: 2, state: 'paid', org: replacement }));
    expect(res.status).toBe(404);
    expect(await stored(receiptId)).toEqual([1]);
  });

  it('revoked-terminal attempts leave no audit entry (they fail before signature checking) — recorded as a finding', async () => {
    const org = await w.addOrg();
    const sdk = sdkForOrg(org, new MemoryStore());
    const { receiptId } = await sdk.createReceipt(simpleDraft);
    await w.revoke(org);
    await sdk.flush();
    expect(await sql(w, 'select 1 from ops.audit_log where terminal_id = $1', [org.terminal.terminalId])).toHaveLength(0);
    expect(await stored(receiptId)).toEqual([]);
  });
});
