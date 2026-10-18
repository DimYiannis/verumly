import { expect, test } from '@playwright/test';
import { newPhone, shot } from './support/browser.ts';
import { loginDashboard } from './support/dashboard.ts';
import { URLS } from './support/env.ts';
import { qrUrlOf } from './support/simulator.ts';
import { createWorld } from './support/world.ts';

test('a German business: setup asks for the German legal settings, the till issues a German receipt with the TSE data, and the wallet draws it with the merchant design', async ({ browser, page }) => {
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

  // --- the setup shows the receipt format and the state integration of Germany ---
  await page.goto(`${URLS.merchantWeb}/dashboard/organisation`);
  await expect(page.getByTestId('org-format')).toContainText('EUR');
  await expect(page.getByTestId('org-format')).toContainText('19%');
  await expect(page.getByTestId('org-fiscal')).toContainText('TSE');
  await expect(page.getByTestId('org-fiscal')).toContainText('Transaktionsnummer');
  await shot(page, 'state-integration-germany');

  // --- the till issues a German receipt: paid, then fiscalised by the (sandbox) TSE ---
  await page.goto(`${URLS.merchantWeb}/simulator`);
  await page.getByTestId('sim-setup').click();
  await expect(page.getByTestId('sim-terminal-id')).toBeVisible();
  await expect(page.getByTestId('sim-fiscal')).toContainText('TSE');
  await page.getByTestId('sim-add-koffie').click();
  await page.getByTestId('sim-issue').click();
  await expect(page.getByTestId('sim-qr').locator('svg')).toBeVisible();
  await expect(page.getByTestId('sim-version')).toHaveText('2'); // v1 paid, v2 fiscalised
  await expect(page.getByTestId('sim-fiscal-data')).toContainText('AB12CD34'); // the TSE serial of the setup
  await expect(page.getByTestId('sim-fiscal-data')).toContainText('Transaktionsnummer');
  await shot(page, 'till-germany-fiscal-data');
  const qr = await qrUrlOf(page);

  const phone = await newPhone(browser);
  try {
    const m = await phone.newPage();
    await m.goto(qr.url);
    await expect(m.getByTestId('receipt-template')).toBeVisible();
    await expect(m.getByTestId('receipt-template')).toContainText('Dankjewel, tot snel!');
    await expect(m.getByTestId('receipt-line')).toHaveCount(1);
    // German identity label and the TSE data, with the names of the country
    await expect(m.getByTestId('receipt-template')).toContainText('Steuernr.');
    await expect(m.getByTestId('receipt-template')).toContainText('TSE-Seriennummer');
    await expect(m.getByTestId('receipt-template')).toContainText('AB12CD34');
    await expect(m.getByTestId('receipt-template')).toContainText('€');
    await shot(m, 'receipt-with-merchant-template');
  } finally {
    await phone.close();
  }
});
