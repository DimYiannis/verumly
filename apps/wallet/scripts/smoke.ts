/**
 * Wallet smoke test (not a CI test; Playwright E2E is a later step). Starts the real merchant-api + buyer-api against a
 * throwaway database, serves the wallet (`WALLET_MODE=prod` = built `.output` server, default; `dev` = `nuxt dev`) on
 * :3001, and drives a phone-sized Chromium through the buyer flow. Screenshots go to /tmp/wallet-smoke.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Route } from '@playwright/test';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { deleteMailFor, mailpitCode, startStack } from '../../../scripts/lib/harness.ts';

const WALLET = 'http://localhost:3001';
const SHOTS = '/tmp/wallet-smoke';
const mode = process.env.WALLET_MODE === 'dev' ? 'dev' : 'prod';
mkdirSync(SHOTS, { recursive: true });
const step = (name: string) => console.log(`  ✔ ${name}`);

const stack = await startStack({ startMerchant: true });
let wallet: ChildProcess | undefined;
try {
  const env = { ...process.env, NUXT_PUBLIC_BUYER_API: stack.buyerUrl, PORT: '3001', HOST: '127.0.0.1', NITRO_PORT: '3001', NITRO_HOST: '127.0.0.1' };
  wallet =
    mode === 'dev'
      ? spawn('pnpm', ['exec', 'nuxt', 'dev', '--port', '3001'], { cwd: import.meta.dirname + '/..', env, stdio: 'ignore', detached: true })
      : spawn('node', ['.output/server/index.mjs'], { cwd: import.meta.dirname + '/..', env, stdio: 'ignore', detached: true });
  for (let i = 0; i < 120; i++) {
    const up = await fetch(WALLET).then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(i < 119, 'wallet did not start');
  }
  step(`wallet (${mode}) up on ${WALLET}, buyer-api ${stack.buyerUrl}`);

  const sdk = new TerminalSdk({
    apiBase: stack.merchantUrl,
    receiptHost: WALLET,
    terminalId: stack.terminal.terminalId,
    apiKey: stack.terminal.apiKey,
    privateKey: stack.terminal.keys.privateKey,
    merchant: { kvkNumber: stack.org.kvk, vatNumber: stack.org.vat, name: 'Café Het Plein', locationId: stack.location.id },
    store: new MemoryStore(),
  });
  const present = async () => {
    const r = await sdk.createReceipt({
      state: 'presented',
      lines: [
        { sku: 'KOF', description: 'Koffie', qty: 2, unitPrice: 340, vatRate: 9, category: 'dining' },
        { sku: 'BIER', description: 'Bier', qty: 1, unitPrice: 389, vatRate: 21, category: 'dining' },
      ],
    });
    assert.equal((await sdk.flush()).retry, false);
    return r;
  };

  const browser = await chromium.launch({ channel: 'chromium' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const T = (id: string) => page.getByTestId(id);

  // 1. logged out: read-only render, banner, fragment stripped
  const first = await present();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(first.qrUrl);
  await T('presented-banner').waitFor();
  assert.match(await T('presented-banner').innerText(), /Not a final receipt/);
  assert.equal(new URL(page.url()).hash, '', `fragment still in URL: ${page.url()}`);
  assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await T('receipt-line').count(), 2);
  await T('save-to-wallet').waitFor();
  assert.equal(await T('confirm-sheet').count(), 0, 'logged-out visitors see no confirm sheet');
  const secret = new URL(first.qrUrl).hash.slice(1);
  assert.ok(!requests.some((u) => u.includes(secret)), 'secret leaked into a request URL');
  await page.screenshot({ path: `${SHOTS}/1-banner-readonly.png`, fullPage: true });
  step(`logged out: banner + ${await T('receipt-line').count()} lines + Save-to-wallet; URL now ${page.url()}`);

  // 2. save -> email-code login -> back on the sheet
  await T('save-to-wallet').click();
  await page.waitForURL(/\/login\?next=/);
  const email = `wallet-smoke-${Date.now()}@example.test`;
  await deleteMailFor(email);
  await T('login-email').fill(email);
  await T('login-send').click();
  await T('login-code').waitFor();
  await T('login-code').fill(await mailpitCode(email));
  await T('login-verify').click();
  await T('confirm-sheet').waitFor();
  assert.match(page.url(), new RegExp(`/r/${first.receiptId}$`));
  assert.match(await T('sheet-merchant').innerText(), /Café Het Plein/);
  assert.match((await T('sheet-total').innerText()).replace(/\s/g, ' '), /€10\.69|€10\.70/);
  await page.screenshot({ path: `${SHOTS}/2-confirm-sheet.png` });
  step(`login via Mailpit code, returned to sheet "Save this receipt?" (${(await T('sheet-total').innerText()).replace(/\s/g, ' ')})`);

  // 3. save -> receipt detail
  await T('save-button').click();
  await page.waitForURL(/\/receipts\/.+saved=1/);
  await T('receipt-view').waitFor();
  await T('presented-banner').waitFor();
  assert.equal(await T('vat-row').count(), 2);
  await page.screenshot({ path: `${SHOTS}/3-saved-detail.png`, fullPage: true });
  step('claimed: receipt detail with pre-bill banner and 2 VAT rows');

  // 4. wallet list
  await page.goto(WALLET + '/');
  await T('receipt-item').first().waitFor();
  assert.equal(await T('receipt-item').count(), 1);
  await page.screenshot({ path: `${SHOTS}/4-wallet.png`, fullPage: true });
  step('wallet lists the receipt, grouped by day');

  // 5. SW + offline reading of a saved receipt (prod only: the dev server has no service worker)
  if (mode === 'prod') {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
    assert.ok(manifestHref, 'no manifest link');
    await context.setOffline(true);
    await page.goto(`${WALLET}/receipts/${first.receiptId}`);
    await T('receipt-view').waitFor();
    await T('cached-notice').waitFor();
    await T('offline-badge').waitFor();
    assert.equal(await T('receipt-line').count(), 2);
    await page.screenshot({ path: `${SHOTS}/5-offline-saved.png` });
    step('offline: shell served by service worker, saved receipt renders from IndexedDB');

    // 6. offline link -> Arriving -> claim completes when back online
    const second = await present();
    await page.goto(second.qrUrl);
    await T('arriving-state').waitFor();
    assert.equal(new URL(page.url()).hash, '');
    await page.screenshot({ path: `${SHOTS}/6-arriving.png` });
    await page.goto(WALLET + '/');
    await T('arriving-item').waitFor();
    step('offline: new link shows "Arriving" (pending claim in IndexedDB)');
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=arriving-item]').length === 0, undefined, { timeout: 20_000 });
    await T('receipt-item').nth(1).waitFor();
    assert.equal(await T('receipt-item').count(), 2);
    await page.screenshot({ path: `${SHOTS}/7-arrived.png`, fullPage: true });
    step('back online: pending claim completed, wallet now has 2 receipts');

    // 7. payment arrives as a new version: final after reload
    await sdk.addVersion(first.receiptId, { state: 'paid', payments: [{ method: 'cash' }] });
    assert.equal((await sdk.flush()).retry, false);
    await page.goto(`${WALLET}/receipts/${first.receiptId}`);
    await T('final-badge').waitFor();
    assert.equal(await T('presented-banner').count(), 0);
    assert.ok((await T('receipt-rounding').count()) === 1);
    await T('version-history').waitFor();
    await page.screenshot({ path: `${SHOTS}/8-final.png`, fullPage: true });
    step('v3 paid: final badge, rounding, version history');
  }

  if (mode === 'prod') {
    // 7b. a Web Push reaches the service worker and becomes a notification for that receipt (delivered through CDP)
    await context.grantPermissions(['notifications'], { origin: WALLET });
    const cdp = await context.newCDPSession(page);
    const registrations: { registrationId: string; scopeURL: string }[] = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => registrations.splice(0, registrations.length, ...e.registrations));
    await cdp.send('ServiceWorker.enable');
    await page.waitForTimeout(500);
    const reg = registrations.find((r) => r.scopeURL.startsWith(WALLET));
    assert.ok(reg, 'no service worker registration');
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: WALLET,
      registrationId: reg.registrationId,
      data: JSON.stringify({ title: 'Receipt updated', body: 'Your receipt is now final.', receiptId: first.receiptId, version: 3, final: true }),
    });
    const readNotifications = () =>
      page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data })));
    let shown = await readNotifications();
    for (let i = 0; i < 20 && shown.length === 0; i++) {
      await page.waitForTimeout(250);
      shown = await readNotifications();
    }
    assert.deepEqual(shown, [{ title: 'Receipt updated', body: 'Your receipt is now final.', tag: first.receiptId, data: { receiptId: first.receiptId, version: 3, final: true } }]);
    step('push: service worker showed the notification (title/body/tag/data) for the receipt');
  }

  // 8. add receipt: presign -> PUT -> complete -> poll -> correction -> match offer -> accept.
  // The throwaway stack has no S3/worker, so these endpoints are mocked at the network layer (UI check only).
  {
    const cors = { 'access-control-allow-origin': WALLET, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    let polls = 0;
    let patched = false;
    const draft = { merchantName: 'Albert Heijn', printedAt: '2026-10-01T15:42:00.000Z', gross: 1999, rounding: 0, lines: [{ description: 'Melk', qty: '1', unitPrice: 109, total: 109, vatRate: 9, kind: 'item' }], vatBreakdown: [], paymentMethod: 'card' };
    const view = (status: string) => ({
      uploadId: 'u1',
      status,
      failures: status === 'needs_review' ? ['total_mismatch'] : [],
      draft: status === 'processing' ? null : draft,
      matchedReceiptId: status === 'done' ? first.receiptId : null,
      match: status === 'done' ? { receiptId: first.receiptId, merchantName: 'Café Het Plein', total: 1069, createdAt: '2026-10-16T18:35:00.000Z' } : null,
      createdAt: new Date().toISOString(),
    });
    const fulfil = (route: Route, status: number, body?: unknown) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
    await page.route('http://s3.test/**', (route) => fulfil(route, 200));
    await page.route(`${stack.buyerUrl}/v1/me/uploads**`, async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'OPTIONS') return fulfil(route, 204);
      if (req.method() === 'POST' && path.endsWith('/uploads')) return fulfil(route, 201, { uploadId: 'u1', uploadUrl: 'http://s3.test/receipts/u1?sig=x', headers: { 'content-type': 'image/png' } });
      if (path.endsWith('/complete')) return fulfil(route, 202, { uploadId: 'u1', status: 'processing' });
      if (path.endsWith('/accept-match')) return fulfil(route, 200, { receiptId: first.receiptId });
      if (req.method() === 'PATCH') {
        patched = true;
        return fulfil(route, 200, view('done'));
      }
      polls += 1;
      return fulfil(route, 200, view(patched ? 'done' : polls < 2 ? 'processing' : 'needs_review'));
    });
    await page.goto(WALLET + '/add');
    // a real image: the wallet decodes and checks the photo before it uploads anything
    await T('file-input').setInputFiles(fileURLToPath(new URL('../../../fixtures/receipts-nl/mock/mock-weegschaal.png', import.meta.url)));
    await page.waitForURL(/\/uploads\/u1$/);
    await T('correction-form').waitFor({ timeout: 15_000 });
    assert.equal(await T('corr-merchant').inputValue(), 'Albert Heijn');
    assert.equal(await T('corr-gross').inputValue(), '19.99');
    await page.screenshot({ path: `${SHOTS}/9-correction-form.png`, fullPage: true });
    await T('corr-gross').fill('1.09');
    await T('corr-submit').click();
    await T('match-offer').waitFor();
    assert.match(await T('match-offer').innerText(), /Official receipt found — replace\?/);
    await page.screenshot({ path: `${SHOTS}/10-match-offer.png`, fullPage: true });
    await T('accept-match').click();
    await page.waitForURL(new RegExp(`/receipts/${first.receiptId}`));
    step('add receipt (API mocked): upload -> needs_review form -> PATCH -> "Official receipt found — replace?" -> accept-match -> receipt');
  }

  assert.deepEqual(consoleErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'console errors');
  step('no console errors (offline network failures excluded)');
  await browser.close();
} finally {
  // detached = own process group, so `pnpm exec nuxt dev` children die with it
  if (wallet?.pid) process.kill(-wallet.pid, 'SIGTERM');
  await stack.stopAll();
}
