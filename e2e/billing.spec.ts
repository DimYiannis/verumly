import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { shot } from './support/browser.ts';
import { loginDashboard } from './support/dashboard.ts';
import { URLS } from './support/env.ts';
import { createWorld } from './support/world.ts';

/** Billing page → plan card → checkout page with the given test card → back on Billing with the outcome. */
async function payWithCard(page: Page, o: { plan: 'starter' | 'business'; interval: 'monthly' | 'annual'; card: string; screenshot?: string }) {
  await page.getByTestId(`billing-interval-${o.interval}`).click();
  await page.getByTestId(`plan-choose-${o.plan}`).click();
  await expect(page).toHaveURL(/\/billing\/checkout\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('checkout-demo-banner')).toContainText('Demo payment');
  await page.getByTestId('checkout-method-card').click();
  await page.getByTestId('checkout-card-number').fill(o.card);
  await page.getByTestId('checkout-card-expiry').fill('12/30');
  await page.getByTestId('checkout-card-cvc').fill('123');
  if (o.screenshot) await shot(page, o.screenshot);
  await page.getByTestId('checkout-pay').click();
  await expect(page).toHaveURL(/\/dashboard\/billing/);
}

test('billing: trial → annual Business → checkout with card 4242 → active, invoice listed, PDF downloads', async ({ page }) => {
  const world = await createWorld();
  await loginDashboard(page, world);
  await page.getByTestId('nav-billing').click();
  await expect(page).toHaveURL(/\/dashboard\/billing$/);
  await expect(page.getByTestId('billing-status')).toHaveText('Trial · 14 days left');
  await expect(page.getByTestId('invoice-row')).toHaveCount(0);

  // annual prices: per-month equivalent, billed per year, excl. and incl. BTW
  await page.getByTestId('billing-interval-annual').click();
  await expect(page.getByTestId('billing-two-months-free')).toBeVisible();
  await expect(page.getByTestId('plan-card-business')).toContainText('€40,83');
  await expect(page.getByTestId('plan-card-business')).toContainText('€490,00');
  await expect(page.getByTestId('plan-card-business')).toContainText('€592,90');
  await shot(page, 'billing-trial');

  await page.getByTestId('plan-choose-business').click();
  await expect(page).toHaveURL(/\/billing\/checkout\//);
  await expect(page.getByTestId('checkout-merchant')).toHaveText(world.merchantName);
  await expect(page.getByTestId('checkout-net')).toHaveText('€490,00');
  await expect(page.getByTestId('checkout-vat')).toHaveText('€102,90');
  await expect(page.getByTestId('checkout-total')).toHaveText('€592,90');
  // format validation before anything is sent
  await page.getByTestId('checkout-method-card').click();
  await page.getByTestId('checkout-card-number').fill('4242 4242 4242 4241');
  await page.getByTestId('checkout-pay').click();
  await expect(page.getByText('Enter a valid card number.')).toBeVisible();
  await page.getByTestId('checkout-card-number').fill('4242424242424242');
  await expect(page.getByTestId('checkout-card-number')).toHaveValue('4242 4242 4242 4242');
  await page.getByTestId('checkout-card-expiry').fill('1230');
  await expect(page.getByTestId('checkout-card-expiry')).toHaveValue('12/30');
  await page.getByTestId('checkout-card-cvc').fill('123');
  await shot(page, 'billing-checkout');
  await page.getByTestId('checkout-pay').click();
  await expect(page.getByTestId('checkout-processing')).toBeVisible();

  await expect(page).toHaveURL(/\/dashboard\/billing/);
  await expect(page.getByTestId('billing-payment-success')).toBeVisible();
  await expect(page.getByTestId('billing-status')).toHaveText('Active');
  await expect(page.getByTestId('billing-plan')).toHaveText('Business · Annual');
  await expect(page.getByTestId('billing-method')).toHaveText('Card •••• 4242');
  await expect(page.getByTestId('billing-next')).toBeVisible();
  await expect(page.getByTestId('invoice-row')).toHaveCount(1);
  await expect(page.getByTestId('invoice-row')).toContainText('€592,90');
  await expect(page.getByTestId('invoice-status')).toHaveText('Paid');
  await shot(page, 'billing-active');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('invoice-pdf').click()]);
  expect(download.suggestedFilename()).toMatch(/^invoice-LR-\d{4}-\d{6}\.pdf$/);
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe('%PDF-');

  // a plan change is scheduled for the renewal and can be undone
  await page.getByTestId('billing-interval-monthly').click();
  await page.getByTestId('plan-choose-starter').click();
  await expect(page.getByTestId('billing-pending')).toContainText('Changes to Starter (monthly)');
  await page.getByTestId('billing-undo').click();
  await expect(page.getByTestId('billing-pending')).toHaveCount(0);
});

test('billing: card 4000 0000 0000 0002 is declined → still on the trial, with a failure notice', async ({ page }) => {
  const world = await createWorld();
  await loginDashboard(page, world);
  await page.goto(`${URLS.merchantWeb}/dashboard/billing`);
  await expect(page.getByTestId('billing-status')).toContainText('Trial');
  await payWithCard(page, { plan: 'starter', interval: 'monthly', card: '4000 0000 0000 0002' });
  await expect(page.getByTestId('billing-payment-failed')).toBeVisible();
  await expect(page.getByTestId('billing-status')).toHaveText('Trial · 14 days left');
  await expect(page.getByTestId('billing-method')).toHaveText('None yet');
  await expect(page.getByTestId('invoice-row')).toHaveCount(0);
  await shot(page, 'billing-declined');
});

test('billing: card 0341 pays → active → "Simulate renewal now" → the renewal fails and the payment-failed banner shows', async ({ page }) => {
  const world = await createWorld();
  await loginDashboard(page, world);
  await page.goto(`${URLS.merchantWeb}/dashboard/billing`);
  await payWithCard(page, { plan: 'business', interval: 'monthly', card: '4000 0000 0000 0341' });
  await expect(page.getByTestId('billing-payment-success')).toBeVisible();
  await expect(page.getByTestId('billing-status')).toHaveText('Active');
  await expect(page.getByTestId('billing-banner')).toHaveCount(0);

  await page.getByTestId('billing-simulate').click();
  await expect(page.getByTestId('billing-simulated')).toContainText('Renewal payment failed');
  await expect(page.getByTestId('billing-status')).toHaveText('Payment failed');
  await expect(page.getByTestId('billing-banner')).toHaveText('Payment failed, update your payment method');
  await expect(page.getByTestId('invoice-status')).toHaveText(['Failed', 'Paid']);
  await shot(page, 'billing-past-due');

  // the banner follows the user around the dashboard
  await page.getByTestId('nav-overview').click();
  await expect(page.getByTestId('billing-banner')).toHaveText('Payment failed, update your payment method');
});
