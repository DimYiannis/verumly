import { expect, test } from '@playwright/test';
import { newPhone, shot } from './support/browser.ts';
import { clearMailFor, mailpitReceiptLink } from './support/mailpit.ts';
import { openSimulator, qrUrlOf } from './support/simulator.ts';
import { createWorld, uniqueEmail } from './support/world.ts';

test('the customer has no phone at the till: the receipt link is sent to their e-mail, opens without an account, and the shop keeps no address', async ({ browser, page }) => {
  const world = await createWorld();
  const customer = uniqueEmail('customer');
  await clearMailFor(customer);

  // --- till: a sale is issued, the customer asks for the link by e-mail on the customer screen ---
  await openSimulator(page, world);
  await page.getByTestId('sim-add-koffie').click();
  await page.getByTestId('sim-add-bier').click();
  await page.getByTestId('sim-issue').click();
  await expect(page.getByTestId('sim-qr').locator('svg')).toBeVisible();
  const qr = await qrUrlOf(page);

  await expect(page.getByTestId('sim-email-send')).toBeDisabled(); // nothing typed yet
  await page.getByTestId('sim-email-input').fill('not an address');
  await expect(page.getByTestId('sim-email-send')).toBeDisabled();
  await page.getByTestId('sim-email-input').fill(customer);
  await page.getByTestId('sim-email-send').click();
  await expect(page.getByTestId('sim-email-sent')).toBeVisible();
  await expect(page.getByTestId('sim-email-input')).toHaveValue(''); // the address is not kept on the screen either
  await shot(page, 'till-email-receipt');

  // --- the mail carries the same link as the QR code ---
  const link = await mailpitReceiptLink(customer);
  expect(link).toBe(qr.url);

  // --- the link opens the receipt on a phone, no login needed ---
  const phone = await newPhone(browser);
  try {
    const m = await phone.newPage();
    await m.goto(link);
    await expect(m.getByTestId('receipt-template')).toBeVisible();
    await expect(m.getByTestId('receipt-line')).toHaveCount(2);
  } finally {
    await phone.close();
  }
});
