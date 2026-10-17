import { expect, test } from '@playwright/test';
import { loginDashboard } from './support/dashboard.ts';
import { URLS } from './support/env.ts';
import { createWorld } from './support/world.ts';

/** Calls merchant-api exactly as a till would. */
async function terminalStatus(apiKey: string, terminalId: string): Promise<number> {
  const res = await fetch(`${URLS.merchantApi}/v1/terminals/me`, { headers: { authorization: `Bearer ${apiKey}`, 'x-terminal-id': terminalId } });
  return res.status;
}

test('dashboard: TOTP login, create a terminal, key shown once, revoke', async ({ page }) => {
  const world = await createWorld();

  // first login enrols the authenticator (code computed with otpauth from the seed on the page) ...
  await loginDashboard(page, world);
  await expect(page.getByTestId('whoami')).toContainText(world.merchantName);
  // ... after logging out, the next login verifies with a freshly computed code
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await loginDashboard(page, world);

  await page.getByTestId('nav-terminals').click();
  await expect(page.getByTestId('terminal-label')).toBeVisible();
  // the form is usable before the location list has loaded; wait for it so the terminal is created for a real location
  await expect(page.getByTestId('terminal-location').locator('option')).not.toHaveCount(0);
  await page.getByTestId('terminal-label').fill('Kassa E2E');
  await page.getByTestId('terminal-generate').click();
  await expect(page.getByTestId('terminal-public-key')).not.toHaveValue('');
  await page.getByTestId('terminal-create').click();

  // the API key is shown once
  const keyBox = page.getByTestId('terminal-key');
  await expect(keyBox).toBeVisible();
  const apiKey = (await keyBox.textContent())?.trim() ?? '';
  expect(apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const terminalId = (await page.getByTestId('terminal-id').textContent())?.trim() ?? '';
  expect(await terminalStatus(apiKey, terminalId), 'the new key works').toBe(200);

  const row = page.locator(`[data-testid="terminal-row"][data-terminal-id="${terminalId}"]`);
  await expect(row.getByTestId('terminal-label-cell')).toHaveText('Kassa E2E');
  await expect(row.getByTestId('terminal-status')).toHaveText('active');

  await page.getByTestId('terminal-key-dismiss').click();
  await expect(page.getByTestId('terminal-created')).toBeHidden();
  expect(await page.content(), 'the key is gone from the page after dismissing').not.toContain(apiKey);

  await page.reload();
  await expect(row.getByTestId('terminal-status')).toHaveText('active');
  await expect(page.getByTestId('terminal-created')).toBeHidden();
  expect(await page.content(), 'the key is gone after a reload').not.toContain(apiKey);
  const listed = await page.request.get(`${URLS.merchantWeb}/api/dashboard/terminals`);
  expect(await listed.text(), 'the terminal list API never returns the key').not.toContain(apiKey);

  // revoke: two-step confirm, then merchant-api refuses the key
  await row.getByTestId('terminal-revoke').click();
  await row.getByTestId('terminal-revoke-confirm').click();
  await expect(row.getByTestId('terminal-status')).toHaveText('revoked');
  expect(await terminalStatus(apiKey, terminalId), 'the revoked key is refused').toBe(401);
});
