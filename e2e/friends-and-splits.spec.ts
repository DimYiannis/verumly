import { expect, test, type Page } from '@playwright/test';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { newPhone, shot, walletLogin } from './support/browser.ts';
import { URLS } from './support/env.ts';
import { createWorld, provisionTerminal, uniqueEmail } from './support/world.ts';

async function setProfile(page: Page, name: string, handle: string) {
  await page.goto(`${URLS.wallet}/friends`);
  await page.getByTestId('profile-name').fill(name);
  await page.getByTestId('profile-handle').fill(handle);
  await page.getByTestId('profile-save').click();
  await expect(page.getByTestId('friends-add-input')).toBeVisible();
}

test('two buyers: become friends, split a saved receipt, settle, balances follow', async ({ browser }) => {
  const world = await createWorld();
  const terminal = await provisionTerminal(world, 'Kassa vrienden');
  const suffix = Math.random().toString(36).slice(2, 8);
  const samHandle = `sam_${suffix}`;
  const annaHandle = `anna_${suffix}`;

  // a till issues one receipt (2 x coffee, 1 beer = 10.69), already paid
  const sdk = new TerminalSdk({
    apiBase: URLS.merchantApi,
    receiptHost: URLS.wallet,
    terminalId: terminal.terminalId,
    apiKey: terminal.apiKey,
    privateKey: terminal.keys.privateKey,
    merchant: { kvkNumber: world.kvkNumber, vatNumber: null, name: world.merchantName, locationId: world.locationId },
    store: new MemoryStore(),
  });
  const receipt = await sdk.createReceipt({
    state: 'paid',
    lines: [
      { sku: 'koffie', description: 'Koffie', unitPrice: 340, vatRate: 9 as const, qty: 2 },
      { sku: 'bier', description: 'Bier', unitPrice: 389, vatRate: 21 as const, qty: 1 },
    ],
  });
  expect(await sdk.flush()).toMatchObject({ sent: 1, rejected: 0, retry: false });

  const samPhone = await newPhone(browser);
  const annaPhone = await newPhone(browser);
  try {
    // --- Sam saves the receipt and picks a handle ---
    const sam = await samPhone.newPage();
    await sam.goto(receipt.qrUrl);
    await sam.getByTestId('save-to-wallet').click();
    await sam.waitForURL(/\/login/);
    await walletLogin(sam, uniqueEmail('sam'));
    await sam.getByTestId('save-button').click();
    await sam.waitForURL(new RegExp(`/receipts/${receipt.receiptId}`));
    await setProfile(sam, 'Sam', samHandle);

    // --- Anna logs in and picks a handle ---
    const anna = await annaPhone.newPage();
    await anna.goto(`${URLS.wallet}/login`);
    await walletLogin(anna, uniqueEmail('anna'));
    await anna.waitForURL((u) => !u.pathname.startsWith('/login')); // the session exists once the login page is left
    await setProfile(anna, 'Anna', annaHandle);

    // --- Sam asks Anna, Anna accepts ---
    await sam.getByTestId('friends-add-input').fill(annaHandle);
    await sam.getByTestId('friends-add-submit').click();
    await anna.goto(`${URLS.wallet}/friends`);
    await anna.getByTestId('friend-request-accept').click();
    await sam.goto(`${URLS.wallet}/friends`);
    await expect(sam.getByTestId('friend-row')).toHaveCount(1);
    await shot(sam, 'friends');

    // --- Sam splits the receipt equally with Anna ---
    await sam.goto(`${URLS.wallet}/receipts/${receipt.receiptId}/split`);
    await sam.getByTestId('split-participant-0').click();
    await expect(sam.getByTestId('split-create')).toBeEnabled();
    await shot(sam, 'split-form');
    await sam.getByTestId('split-create').click();
    await sam.waitForURL(/\/splits\//);
    await expect(sam.getByTestId('split-share-settle')).toHaveCount(1);
    await shot(sam, 'split-detail');

    // --- Anna owes her half, and settles it ---
    await anna.goto(`${URLS.wallet}/friends`);
    await expect(anna.getByTestId('balance-total-owe')).toContainText(/5[.,]3[45]/); // half of 10.69, the odd cent goes to the first person
    await anna.getByTestId('split-open').first().click();
    await anna.waitForURL(/\/splits\//);
    await anna.getByTestId('split-share-settle').first().click();
    await expect(anna.getByTestId('split-share-settle').first()).toContainText(/undo|ongedaan/i);

    // --- Sam sees nothing owed any more ---
    await sam.goto(`${URLS.wallet}/friends`);
    await expect(sam.getByTestId('balance-total-owed')).toContainText(/0[.,]00/);
  } finally {
    await samPhone.close();
    await annaPhone.close();
  }
});
