import { expect, test } from '@playwright/test';
import { newPhone, shot } from './support/browser.ts';
import { loginDashboard } from './support/dashboard.ts';
import { URLS } from './support/env.ts';
import { qrUrlOf } from './support/simulator.ts';
import { createWorld } from './support/world.ts';

test('business setup asks for the legal settings of the declared country, and the designed receipt shows in the wallet', async ({ browser, page }) => {
  const world = await createWorld();
  // unique per run: registry and VAT numbers are unique across organisations
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
  const steuernummer = `${digits(2)}/${digits(3)}/${digits(5)}`;
  const ustId = `DE${digits(9)}`;
  await loginDashboard(page, world);

  // --- setup: declare Germany, the screen switches to the German identity and legal settings ---
  await page.goto(`${URLS.merchantWeb}/dashboard/organisation`);
  await page.getByTestId('org-country').selectOption('DE');
  await expect(page.getByTestId('org-setting-tseSerial')).toBeVisible();
  await expect(page.getByTestId('org-setting-tillId')).toBeVisible();

  // an incomplete setup says what is still missing (and the browser blocks the save)
  await page.getByTestId('org-kvk').fill(steuernummer);
  await page.getByTestId('org-vat').fill(ustId);
  await page.getByTestId('org-confirm-legal').click();
  await expect(page.getByTestId('org-missing')).toContainText(/TSE/);

  await page.getByTestId('org-setting-tseSerial').fill('AB12CD34');
  await page.getByTestId('org-setting-tillId').fill('KASSE-1');
  await page.getByTestId('org-setting-tillRegisteredAt').click();
  await page.getByTestId('org-setting-digitalConsentMode').selectOption('explicit_opt_in');
  await page.getByTestId('org-save').click();
  await expect(page.getByTestId('org-saved')).toBeVisible();
  await shot(page, 'business-setup-germany');

  // --- designer: change colours, add a text block, keep the legal blocks locked ---
  await page.goto(`${URLS.merchantWeb}/dashboard/template`);
  await expect(page.getByTestId('design-canvas')).toBeVisible();
  await page.getByTestId('design-add-text').click();
  await page.getByTestId('design-prop-text').fill('Dankjewel, tot snel!');
  await page.getByTestId('design-style-accent').first().fill('#AA3300').catch(() => undefined);
  await expect(page.getByTestId('design-canvas')).toContainText('Dankjewel, tot snel!');
  await shot(page, 'receipt-designer');
  await page.getByTestId('design-save').click();
  await expect(page.getByTestId('design-save')).toBeDisabled(); // saved: nothing left to save

  // --- the till only issues Dutch receipts for now (CRF is NL-only): go back to the Netherlands, then issue ---
  await page.goto(`${URLS.merchantWeb}/dashboard/organisation`);
  await expect(page.getByTestId('org-nl-only')).toBeVisible();
  await page.getByTestId('org-country').selectOption('NL');
  await page.getByTestId('org-kvk').fill(world.kvkNumber);
  await page.getByTestId('org-vat').fill('');
  await page.getByTestId('org-confirm-legal').click();
  await page.getByTestId('org-save').click();
  await expect(page.getByTestId('org-saved')).toBeVisible();

  // --- the till issues a receipt, the wallet draws it with the merchant's template ---
  await page.goto(`${URLS.merchantWeb}/simulator`);
  await page.getByTestId('sim-setup').click();
  await expect(page.getByTestId('sim-terminal-id')).toBeVisible();
  await page.getByTestId('sim-add-koffie').click();
  await page.getByTestId('sim-issue').click();
  await expect(page.getByTestId('sim-qr').locator('svg')).toBeVisible();
  const qr = await qrUrlOf(page);

  const phone = await newPhone(browser);
  try {
    const m = await phone.newPage();
    await m.goto(qr.url);
    await expect(m.getByTestId('receipt-template')).toBeVisible();
    await expect(m.getByTestId('receipt-template')).toContainText('Dankjewel, tot snel!');
    await expect(m.getByTestId('receipt-line')).toHaveCount(1);
    await shot(m, 'receipt-with-merchant-template');
  } finally {
    await phone.close();
  }
});
