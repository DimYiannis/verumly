import { expect, test } from '@playwright/test';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { newPhone, shot, walletLogin } from './support/browser.ts';
import { URLS } from './support/env.ts';
import { createWorld, provisionTerminal, uniqueEmail } from './support/world.ts';

test('a bill is split by quantity: 5 beers, 2 are mine and 3 are Anna\'s', async ({ browser }) => {
  const world = await createWorld();
  const terminal = await provisionTerminal(world, 'Kassa bar');

  // the till issues 5 beers at 3,50 and a pizza at 8,00 (total 25,50), paid
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
      { sku: 'bier', description: 'Bier', unitPrice: 350, vatRate: 21, qty: 5 },
      { sku: 'pizza', description: 'Pizza', unitPrice: 800, vatRate: 9, qty: 1 },
    ],
  });
  expect(await sdk.flush()).toMatchObject({ sent: 1, rejected: 0, retry: false });

  const phone = await newPhone(browser);
  try {
    const sam = await phone.newPage();
    await sam.goto(receipt.qrUrl);
    await sam.getByTestId('save-to-wallet').click();
    await sam.waitForURL(/\/login/);
    await walletLogin(sam, uniqueEmail('sam'));
    await sam.getByTestId('save-button').click();
    await sam.waitForURL(new RegExp(`/receipts/${receipt.receiptId}`));

    // --- split with a guest called Anna, by item ---
    await sam.goto(`${URLS.wallet}/receipts/${receipt.receiptId}/split`);
    await sam.getByTestId('split-guest-input').fill('Anna');
    await sam.getByTestId('split-guest-add').click();
    await sam.getByTestId('split-mode-items').click();

    // the beers (5 units) have a counter per person, the pizza (1 unit) keeps the chips
    await expect(sam.getByTestId('split-units-1')).toBeVisible();
    await expect(sam.getByTestId('split-units-2')).toHaveCount(0);
    await expect(sam.getByTestId('split-chip-2-me')).toBeVisible();

    await expect(sam.getByTestId('split-create')).toBeDisabled(); // nothing assigned yet
    for (let i = 0; i < 2; i++) await sam.getByTestId('split-units-more-1-me').click();
    await expect(sam.getByTestId('split-units-left-1')).toContainText('3 of 5');
    for (let i = 0; i < 3; i++) await sam.getByTestId('split-units-more-1-p0').click();
    await expect(sam.getByTestId('split-units-left-1')).toHaveCount(0); // all 5 are assigned
    await expect(sam.getByTestId('split-units-more-1-me')).toBeDisabled(); // no sixth beer
    await sam.getByTestId('split-chip-2-me').click(); // the pizza is mine

    // my share: 2 beers (7,00) + pizza (8,00) = 15,00; Anna: 3 beers = 10,50
    await expect(sam.getByTestId('split-preview-me')).toContainText('€15.00');
    await expect(sam.getByTestId('split-preview-p0')).toContainText('€10.50');
    await shot(sam, 'split-by-quantity');

    // taking a unit back keeps it open until someone has it
    await sam.getByTestId('split-units-less-1-p0').click();
    await expect(sam.getByTestId('split-create')).toBeDisabled();
    await sam.getByTestId('split-units-more-1-p0').click();
    await expect(sam.getByTestId('split-create')).toBeEnabled();

    await sam.getByTestId('split-create').click();
    await sam.waitForURL(/\/splits\//);

    // --- the receipt page says who had how many ---
    await sam.goto(`${URLS.wallet}/receipts/${receipt.receiptId}`);
    await expect(sam.getByTestId('split-hero')).toBeVisible();
    await expect(sam.getByTestId('split-had')).toContainText('Bier ×2');
    await expect(sam.getByTestId('split-had')).toContainText('Bier ×3');
    await shot(sam, 'split-by-quantity-result');
  } finally {
    await phone.close();
  }
});
