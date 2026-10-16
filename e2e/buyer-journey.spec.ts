import { expect, test } from '@playwright/test';
import { newPhone, shot, walletLogin } from './support/browser.ts';
import { clearMailFor, mailpitCode } from './support/mailpit.ts';
import { URLS } from './support/env.ts';
import { startPushEndpoint } from './support/push.ts';
import { expectServerHas, openSimulator, qrUrlOf } from './support/simulator.ts';
import { createWorld, uniqueEmail } from './support/world.ts';

/** A second, independent buyer-api session for the same e-mail address (the wallet keeps its own token in IndexedDB). */
async function buyerApiToken(email: string): Promise<string> {
  await clearMailFor(email);
  const start = await fetch(`${URLS.buyerApi}/v1/auth/email/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  expect(start.status).toBe(202);
  const verify = await fetch(`${URLS.buyerApi}/v1/auth/email/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code: await mailpitCode(email) }) });
  expect(verify.status).toBe(200);
  const body: unknown = await verify.json();
  if (typeof body !== 'object' || body === null || !('token' in body) || typeof body.token !== 'string') throw new Error('no session token');
  return body.token;
}

test('buyer journey on a phone: pre-bill, save, pay, exactly one encrypted push', async ({ browser, page }) => {
  const world = await createWorld();
  const buyerEmail = uniqueEmail('buyer');

  // --- till (desktop): dashboard login, demo terminal, a sale shown as pre-bill ---
  await openSimulator(page, world);
  await page.getByTestId('sim-add-koffie').click();
  await page.getByTestId('sim-add-koffie').click();
  await page.getByTestId('sim-add-bier').click();
  await expect(page.getByTestId('sim-total')).toHaveText(/10[.,]69/);
  await page.getByTestId('sim-present').click();
  await expect(page.getByTestId('sim-state')).toHaveText('presented');
  await expect(page.getByTestId('sim-qr').locator('svg')).toBeVisible();
  const qr = await qrUrlOf(page);
  await expectServerHas(page, qr.receiptId, 1, 'presented');
  await shot(page, 'qr-on-simulator');

  // --- phone: iPhone 13 descriptor opens the URL taken from the QR ---
  const phone = await newPhone(browser);
  const m = await phone.newPage();
  await m.goto(qr.url);
  await expect(m.getByTestId('presented-banner')).toContainText('Not a final receipt');
  await expect(m.getByTestId('receipt-line')).toHaveCount(2);
  await expect(m.getByTestId('confirm-sheet'), 'logged-out visitors get no sheet').toHaveCount(0);
  expect(m.url(), 'the secret is stripped from the address bar').not.toContain('#');
  expect(await m.evaluate(() => location.hash)).toBe('');
  await shot(m, 'prebill-banner-phone');

  // log in with the code Mailpit received, come back to the receipt, confirm "Save this receipt?"
  await m.getByTestId('save-to-wallet').click();
  await m.waitForURL(/\/login/);
  await walletLogin(m, buyerEmail);
  await expect(m.getByTestId('confirm-sheet')).toBeVisible();
  await expect(m.getByTestId('sheet-merchant')).toContainText(world.merchantName);
  await expect(m.getByTestId('sheet-total')).toContainText('10.69');
  expect(m.url()).not.toContain('#');
  await shot(m, 'save-receipt-sheet');
  await m.getByTestId('save-button').click();
  await m.waitForURL(new RegExp(`/receipts/${qr.receiptId}`));
  expect(m.url()).not.toContain('#');
  await m.goto(`${URLS.wallet}/`);
  const item = m.locator(`[data-testid="receipt-item"][data-receipt-id="${qr.receiptId}"]`);
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('data-state', 'presented');
  await shot(m, 'wallet-with-receipt');
  await item.click();
  await expect(m.getByTestId('presented-banner')).toBeVisible();
  await expect(m.getByTestId('receipt-view')).toHaveAttribute('data-version', '1');

  // --- a push subscription with real keys, registered the way the wallet does it ---
  const sub = await startPushEndpoint();
  try {
    const token = await buyerApiToken(buyerEmail);
    const subscribed = await fetch(`${URLS.buyerApi}/v1/me/push-subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }),
    });
    expect(subscribed.status).toBe(201);

    // --- the till pays: version 2, final in NL ---
    await page.getByTestId('sim-pay-card').click();
    await expect(page.getByTestId('sim-state')).toHaveText('paid');
    await expect(page.getByTestId('sim-version')).toHaveText('2');
    await expectServerHas(page, qr.receiptId, 2, 'paid');

    await m.reload();
    await expect(m.getByTestId('final-badge')).toBeVisible();
    await expect(m.getByTestId('receipt-view')).toHaveAttribute('data-state', 'paid');
    await expect(m.getByTestId('receipt-view')).toHaveAttribute('data-version', '2');
    await expect(m.getByTestId('presented-banner')).toHaveCount(0);
    await expect(m.getByTestId('receipt-total')).toContainText('10.69');
    await shot(m, 'final-version-after-paying');

    // --- push: exactly one, encrypted, for version 2 ---
    await expect.poll(() => sub.received.length, { timeout: 45_000, message: 'worker delivers the push' }).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 6_000)); // a duplicate (retry, second job) would arrive within this window
    expect(sub.received, 'exactly one push for the new version').toHaveLength(1);
    const push = sub.received[0];
    if (!push) throw new Error('no push');
    expect(push.headers['content-encoding']).toBe('aes128gcm');
    expect(String(push.headers.authorization)).toMatch(/^vapid /);
    for (const plain of [world.merchantName, 'Café', 'E2E', '10,69', '1069', qr.receiptId]) {
      expect(push.body.toString('latin1').includes(plain), `ciphertext must not contain "${plain}"`).toBe(false);
      expect(push.body.includes(Buffer.from(plain, 'utf8')), `ciphertext must not contain "${plain}" as UTF-8`).toBe(false);
    }
    const payload = sub.decrypt(push);
    expect(payload).toMatchObject({ receiptId: qr.receiptId, version: 2, final: true });
    expect(Object.keys(payload).sort()).toEqual(['body', 'final', 'receiptId', 'title', 'version']);
  } finally {
    await sub.close();
    await phone.close();
  }
});
