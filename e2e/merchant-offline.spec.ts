import { expect, test } from '@playwright/test';
import { shot } from './support/browser.ts';
import { URLS } from './support/env.ts';
import { expectOutboxDrained, openSimulator } from './support/simulator.ts';
import { createWorld } from './support/world.ts';

test('merchant offline: 3 sales while the till is offline all reach the dashboard archive', async ({ page }) => {
  const world = await createWorld();
  await openSimulator(page, world);

  await page.getByTestId('sim-offline-toggle').check();
  await expect(page.getByTestId('sim-network')).toHaveText('offline');

  for (const sku of ['koffie', 'appeltaart', 'bier']) {
    await page.getByTestId(`sim-add-${sku}`).click();
    await page.getByTestId('sim-issue').click();
    await expect(page.getByTestId('sim-state')).toHaveText('paid');
    await page.getByTestId('sim-new-sale').click();
    await expect(page.getByTestId('sim-state')).toHaveText('none');
  }
  await expect(page.getByTestId('sim-pending')).toHaveText('3');

  // nothing has reached the server yet: the dashboard (second tab, same session) shows an empty archive
  const dashboard = await page.context().newPage();
  await dashboard.goto(`${URLS.merchantWeb}/dashboard/archive`);
  await expect(dashboard.getByTestId('archive-empty')).toBeVisible();

  await page.getByTestId('sim-offline-toggle').uncheck();
  await expect(page.getByTestId('sim-network')).toHaveText('online');
  await expectOutboxDrained(page);

  await dashboard.getByTestId('archive-refresh').click();
  await expect(dashboard.getByTestId('archive-row')).toHaveCount(3);
  for (const state of await dashboard.getByTestId('archive-state-cell').allTextContents()) expect(state.trim()).toBe('paid');
  await shot(dashboard, 'dashboard-archive');
});
