import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { MemoryStore, TerminalSdk } from '@lr/terminal-sdk';
import { shot } from './support/browser.ts';
import { loginDashboard } from './support/dashboard.ts';
import { URLS } from './support/env.ts';
import { createWorld, provisionTerminal } from './support/world.ts';

test('custom report: choose grouping and metrics, compare, save a view, export CSV', async ({ page }) => {
  const world = await createWorld();
  const terminal = await provisionTerminal(world, 'Kassa rapport');
  const sdk = new TerminalSdk({
    apiBase: URLS.merchantApi,
    receiptHost: URLS.wallet,
    terminalId: terminal.terminalId,
    apiKey: terminal.apiKey,
    privateKey: terminal.keys.privateKey,
    merchant: { kvkNumber: world.kvkNumber, vatNumber: null, name: world.merchantName, locationId: world.locationId },
    store: new MemoryStore(),
  });
  // two sales (10.69 and 3.89) and one cancelled receipt (3.40), all today
  await sdk.createReceipt({
    state: 'paid',
    lines: [
      { sku: 'koffie', description: 'Koffie', unitPrice: 340, vatRate: 9 as const, qty: 2 },
      { sku: 'bier', description: 'Bier', unitPrice: 389, vatRate: 21 as const, qty: 1 },
    ],
  });
  await sdk.createReceipt({ state: 'paid', lines: [{ sku: 'bier', description: 'Bier', unitPrice: 389, vatRate: 21 as const, qty: 1 }] });
  const cancelled = await sdk.createReceipt({ state: 'paid', lines: [{ sku: 'koffie', description: 'Koffie', unitPrice: 340, vatRate: 9 as const, qty: 1 }] });
  await sdk.voidReceipt(cancelled.receiptId);
  expect(await sdk.flush()).toMatchObject({ rejected: 0, retry: false });

  await loginDashboard(page, world);
  await page.goto(`${URLS.merchantWeb}/dashboard/reports`);

  // default report: totals of the last 30 days
  await expect(page.getByTestId('report-kpi-gross')).toContainText(/14[.,]58/);
  await expect(page.getByTestId('report-kpi-cancelled')).toContainText('1');
  await expect(page.getByTestId('report-chart')).toBeVisible();
  await shot(page, 'custom-report');

  // group by VAT rate: the 21% and 9% rows from the signed VAT summary
  await page.getByTestId('report-group').selectOption('vat_rate');
  await expect(page.getByTestId('report-row')).toHaveCount(2);
  await expect(page.getByTestId('report-table')).toContainText('21%');

  // pick extra metrics and compare with the previous period
  await page.getByTestId('report-metric-net').click();
  await page.getByTestId('report-compare').click();
  await expect(page.getByTestId('report-kpi-net')).toBeVisible();

  // save the view, it shows up in the list and survives a reload
  await page.getByTestId('report-save-name').fill('VAT by rate');
  await page.getByTestId('report-save').click();
  await expect(page.getByText('VAT by rate')).toBeVisible();
  await page.reload();
  await expect(page.getByText('VAT by rate')).toBeVisible();

  // export exactly what is on screen
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-csv').click()]);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toMatch(/21%?/);
  expect(csv.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(4); // header, two rates, total
});
