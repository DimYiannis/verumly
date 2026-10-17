import { expect, test } from '@playwright/test';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { newPhone, shot, walletLogin } from './support/browser.ts';
import { URLS } from './support/env.ts';
import { createWorld, provisionTerminal, uniqueEmail } from './support/world.ts';

test('buyer offline: link opens as Arriving, claim completes online, saved receipts render offline', async ({ browser }) => {
  const world = await createWorld();
  const terminal = await provisionTerminal(world, 'Kassa offline');
  const buyerEmail = uniqueEmail('buyer');

  // a till: the real SDK, signing and uploading to the real merchant-api
  const sdk = new TerminalSdk({
    apiBase: URLS.merchantApi,
    receiptHost: URLS.wallet,
    terminalId: terminal.terminalId,
    apiKey: terminal.apiKey,
    privateKey: terminal.keys.privateKey,
    merchant: { kvkNumber: world.kvkNumber, vatNumber: null, name: world.merchantName, locationId: world.locationId },
    store: new MemoryStore(),
  });
  const lines = [{ sku: 'koffie', description: 'Koffie', unitPrice: 340, vatRate: 9 as const, qty: 1 }];
  const saved = await sdk.createReceipt({ state: 'paid', lines });
  const arriving = await sdk.createReceipt({ state: 'paid', lines: [{ sku: 'bier', description: 'Bier', unitPrice: 389, vatRate: 21 as const, qty: 2 }] });
  expect(await sdk.flush()).toMatchObject({ sent: 2, rejected: 0, retry: false });

  const phone = await newPhone(browser);
  const m = await phone.newPage();
  try {
    // online: log in and save the first receipt; the page is then controlled by the service worker
    await m.goto(saved.qrUrl);
    await m.getByTestId('save-to-wallet').click();
    await m.waitForURL(/\/login/);
    await walletLogin(m, buyerEmail);
    await m.getByTestId('save-button').click();
    await m.waitForURL(new RegExp(`/receipts/${saved.receiptId}`));
    await expect(m.getByTestId('receipt-line')).toHaveCount(1);
    await m.goto(`${URLS.wallet}/receipts`); // the wallet list is cached for offline use whenever it has been loaded online
    await expect(m.locator(`[data-testid="receipt-item"][data-receipt-id="${saved.receiptId}"]`)).toBeVisible();
    await m.waitForFunction(() => navigator.serviceWorker.controller !== null);

    // offline: opening a receipt link shows "Arriving"
    await phone.setOffline(true);
    await m.goto(arriving.qrUrl);
    await expect(m.getByTestId('arriving-state')).toBeVisible();
    expect(m.url(), 'the secret is stripped even offline').not.toContain('#');
    await shot(m, 'arriving-state');

    // offline: the wallet lists the saved receipt and the arriving one ...
    await m.goto(`${URLS.wallet}/receipts`);
    await expect(m.getByTestId('offline-badge')).toBeVisible();
    await expect(m.getByTestId('arriving-item')).toHaveCount(1);
    await expect(m.getByTestId('arriving-item')).toHaveAttribute('data-receipt-id', arriving.receiptId);
    await expect(m.locator(`[data-testid="receipt-item"][data-receipt-id="${saved.receiptId}"]`)).toBeVisible();
    // ... and the saved receipt renders from the local cache
    await m.goto(`${URLS.wallet}/receipts/${saved.receiptId}`);
    await expect(m.getByTestId('cached-notice')).toBeVisible();
    await expect(m.getByTestId('receipt-line')).toHaveCount(1);
    await expect(m.getByTestId('receipt-merchant')).toContainText(world.merchantName);
    await m.goto(`${URLS.wallet}/receipts`);
    await expect(m.getByTestId('arriving-item')).toHaveCount(1);

    // back online, no reload: the pending claim completes by itself
    await phone.setOffline(false);
    await expect(m.getByTestId('arriving-item')).toHaveCount(0);
    await expect(m.getByTestId('receipt-item')).toHaveCount(2);
    await expect(m.locator(`[data-testid="receipt-item"][data-receipt-id="${arriving.receiptId}"]`)).toBeVisible();
    await expect(m.getByTestId('offline-badge')).toHaveCount(0);
  } finally {
    await phone.close();
  }
});
