import assert from 'node:assert/strict';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { getReceiptWithVersions, searchArchive, vatByDay, vatCsv } from '@lr/dashboard-core';
import { connect } from '@lr/db';
import { deleteMailFor, freePort, mailpitCode, startStack, type Stack } from './lib/harness.ts';

export interface JourneyOptions {
  /** unique per run; used by the privacy canary */
  email?: string;
  print?: boolean;
}

export interface JourneyResult {
  stack: Stack;
  email: string;
  secret: string;
  receiptId: string;
  userId: string;
  sessionToken: string;
  /** every merchant-api and dashboard response body seen during the run */
  merchantSideResponses: string[];
  hops: Array<{ name: string; status: string }>;
}

const jsonHeaders = { 'content-type': 'application/json' };

/**
 * Golden journey (v2 §16.A): one process drives real services over HTTP against real Postgres.
 * The dashboard hop calls `@lr/dashboard-core` with the `dashboard` DB role until apps/merchant-web exists.
 */
export async function runJourney(opts: JourneyOptions = {}): Promise<JourneyResult> {
  const print = opts.print ?? true;
  const email = opts.email ?? `journey-${Date.now()}@example.test`;
  const hops: JourneyResult['hops'] = [];
  const hop = async <T>(name: string, fn: () => Promise<{ status: string; value: T }>): Promise<T> => {
    try {
      const { status, value } = await fn();
      hops.push({ name, status });
      if (print) console.log(`  ✔ ${name} — ${status}`);
      return value;
    } catch (e) {
      hops.push({ name, status: 'FAILED' });
      if (print) console.log(`  ✘ ${name} — FAILED`);
      throw e;
    }
  };

  const stack = await startStack({ startMerchant: false });
  const merchantSideResponses: string[] = [];
  // the SDK talks to the merchant API through a recording fetch
  const recordingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    merchantSideResponses.push(await res.clone().text());
    return res;
  };

  const sdk = new TerminalSdk({
    apiBase: stack.merchantUrl,
    receiptHost: 'https://receipts.example',
    terminalId: stack.terminal.terminalId,
    apiKey: stack.terminal.apiKey,
    privateKey: stack.terminal.keys.privateKey,
    merchant: { kvkNumber: stack.org.kvk, vatNumber: stack.org.vat, name: 'Café Het Plein', locationId: stack.location.id },
    store: new MemoryStore(),
    fetch: recordingFetch,
  });
  const buyer = async (path: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    return fetch(`${stack.buyerUrl}${path}`, {
      ...rest,
      headers: { ...jsonHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}), ...rest.headers },
    });
  };

  try {
    await deleteMailFor(email);

    // 1. merchant API is down: the receipt is created locally and the QR URL exists
    const created = await hop('1. SDK creates a presented receipt while the API is unreachable', async () => {
      const r = await sdk.createReceipt({
        state: 'presented',
        lines: [{ sku: 'KOF', description: 'Koffie', qty: 2, unitPrice: 340, vatRate: 9, category: 'dining' }],
      });
      assert.match(r.qrUrl, /^https:\/\/receipts\.example\/r\/[0-9a-f-]{36}#[A-Za-z0-9_-]{43}$/);
      const flushed = await sdk.flush();
      assert.equal(flushed.sent, 0);
      assert.equal(flushed.retry, true, 'flush must report a retry while the API is down');
      return { status: `QR ${r.qrUrl.slice(0, 40)}…, flush retry=true`, value: r };
    });

    // 2. resolving before upload -> pending
    await hop('2. Resolve by secret returns pending', async () => {
      const res = await buyer('/v1/resolve/secret', { method: 'POST', body: JSON.stringify({ receiptId: created.receiptId, secret: created.secret }) });
      const body = (await res.json()) as { status: string };
      assert.equal(res.status, 200);
      assert.equal(body.status, 'pending');
      return { status: `${res.status} ${body.status}`, value: null };
    });

    // 3. API comes back, flusher uploads, resolve returns the preview
    await hop('3. API returns; flusher uploads; resolve returns the preview', async () => {
      await stack.startMerchantApi();
      const flushed = await sdk.flush();
      assert.deepEqual({ sent: flushed.sent, retry: flushed.retry }, { sent: 1, retry: false });
      const res = await buyer('/v1/resolve/secret', { method: 'POST', body: JSON.stringify({ receiptId: created.receiptId, secret: created.secret }) });
      const body = (await res.json()) as { status: string; preview?: { merchantName: string; total: number; state: string; claimed: boolean } };
      assert.equal(body.status, 'ok');
      assert.equal(body.preview?.merchantName, 'Café Het Plein');
      assert.equal(body.preview?.total, 680);
      assert.equal(body.preview?.state, 'presented');
      assert.equal(body.preview?.claimed, false);
      return { status: `${res.status} ok, total ${body.preview?.total}`, value: null };
    });

    // 4. buyer logs in through a Mailpit code, claims, sees it in the wallet
    const session = await hop('4. Buyer logs in (Mailpit code), claims, sees it in the wallet', async () => {
      const start = await buyer('/v1/auth/email/start', { method: 'POST', body: JSON.stringify({ email }) });
      assert.equal(start.status, 202);
      const code = await mailpitCode(email);
      const verify = await buyer('/v1/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
      assert.equal(verify.status, 200);
      const { token, userId } = (await verify.json()) as { token: string; userId: string };
      const claim = await buyer('/v1/me/claims', { method: 'POST', token, body: JSON.stringify({ receiptId: created.receiptId, secret: created.secret, source: 'qr' }) });
      assert.equal(claim.status, 201);
      const list = await buyer('/v1/me/receipts', { token });
      const items = ((await list.json()) as { items: Array<{ receiptId: string; state: string; total: number }> }).items;
      assert.equal(items.length, 1);
      assert.equal(items[0]?.receiptId, created.receiptId);
      assert.equal(items[0]?.state, 'presented');
      return { status: `login 200, claim 201, wallet has 1 receipt`, value: { token, userId } };
    });

    // 5. add an item (v2), pay cash with 5-cent rounding (v3); wallet shows final; notify-version enqueued
    await hop('5. SDK adds an item, pays cash with rounding; wallet shows v3 paid as final; notify-version enqueued', async () => {
      await sdk.addVersion(created.receiptId, {
        lines: [
          { sku: 'KOF', description: 'Koffie', qty: 2, unitPrice: 340, vatRate: 9, category: 'dining' },
          { sku: 'BIER', description: 'Bier', qty: 1, unitPrice: 389, vatRate: 21, category: 'dining' },
        ],
      });
      await sdk.addVersion(created.receiptId, { state: 'paid', payments: [{ method: 'cash' }] });
      const flushed = await sdk.flush();
      assert.equal(flushed.sent, 2);
      const res = await buyer(`/v1/me/receipts/${created.receiptId}`, { token: session.token });
      const body = (await res.json()) as { final: boolean; receipt: { version: number; state: string; totals: { gross: number; rounding: number } }; versions: unknown[] };
      assert.equal(body.receipt.version, 3);
      assert.equal(body.receipt.state, 'paid');
      assert.equal(body.final, true);
      assert.equal(body.receipt.totals.gross, 1069);
      assert.equal(body.receipt.totals.rounding, 1);
      assert.equal(body.versions.length, 3);
      const jobs = await stack.admin.query("select count(*)::int n from pgboss.job where name = 'notify-version'");
      assert.equal(jobs.rows[0].n, 2, 'one notify-version job per version after v1');
      return { status: `v3 paid final, gross 1069, rounding +1, ${jobs.rows[0].n} notify-version jobs`, value: null };
    });

    // 6. dashboard archive + VAT export with per-rate amounts
    await hop('6. Receipt appears in the dashboard archive and in the VAT export (per-rate amounts)', async () => {
      const dash = connect('dashboard', stack.testDb.env);
      try {
        const archive = await searchArchive(dash.db, stack.org.id, {});
        merchantSideResponses.push(JSON.stringify(archive));
        assert.equal(archive.length, 1);
        assert.equal(archive[0]?.id, created.receiptId);
        assert.equal(archive[0]?.state, 'paid');
        const detail = await getReceiptWithVersions(dash.db, stack.org.id, created.receiptId);
        merchantSideResponses.push(JSON.stringify(detail));
        assert.equal(detail?.versions.length, 3);
        // the BTW report groups by Amsterdam day: between 22:00 and 24:00 UTC that is already tomorrow's UTC date
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());
        const rows = await vatByDay(dash.db, stack.org.id, today, today);
        const csv = vatCsv(rows);
        merchantSideResponses.push(csv);
        // independent expectations, worked by hand:
        //   9%:  680 gross → vat round(680×9/109)=56 (56.15), net 624
        //   21%: 389 gross → vat round(389×21/121)=68 (67.52), net 321
        const r9 = rows.find((r) => r.rate === 9);
        const r21 = rows.find((r) => r.rate === 21);
        assert.deepEqual({ g: r9?.gross, n: r9?.net, v: r9?.vat }, { g: 680, n: 624, v: 56 });
        assert.deepEqual({ g: r21?.gross, n: r21?.net, v: r21?.vat }, { g: 389, n: 321, v: 68 });
        return { status: `archive 1 row; VAT 9%: 680/624/56, 21%: 389/321/68`, value: null };
      } finally {
        await dash.close();
      }
    });

    return {
      stack,
      email,
      secret: created.secret,
      receiptId: created.receiptId,
      userId: session.userId,
      sessionToken: session.token,
      merchantSideResponses,
      hops,
    };
  } catch (e) {
    await stack.stopAll();
    throw e;
  }
}

if (import.meta.main) {
  console.log('Golden journey (real Postgres, real HTTP services)');
  void freePort;
  const r = await runJourney();
  await r.stack.stopAll();
  console.log(`\nJourney passed: ${r.hops.length} hops`);
}
