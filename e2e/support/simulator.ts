import { expect, type Page } from '@playwright/test';
import { loginDashboard } from './dashboard.ts';
import { URLS } from './env.ts';
import type { World } from './world.ts';

/** Dashboard login, then /simulator with a freshly set up demo terminal. */
export async function openSimulator(page: Page, world: World): Promise<void> {
  await loginDashboard(page, world);
  await page.goto(`${URLS.merchantWeb}/simulator`);
  await page.getByTestId('sim-setup').click();
  await expect(page.getByTestId('sim-terminal-id')).toBeVisible();
}

/**
 * The till's outbox is empty: everything it signed has been acknowledged by merchant-api. Only meaningful after the outbox was
 * seen non-empty, because `sim-pending` is polled every 400 ms and still shows 0 right after a click; use `expectServerHas` then.
 */
export async function expectOutboxDrained(page: Page): Promise<void> {
  await expect(page.getByTestId('sim-pending')).toHaveText('0');
  await expect(page.getByTestId('sim-rejected')).toHaveText('0');
}

/** merchant-api (seen through the dashboard archive of the signed-in owner) holds `version` of the receipt, in `state`. */
export async function expectServerHas(page: Page, receiptId: string, version: number, state: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`${URLS.merchantWeb}/api/dashboard/archive`, { params: { limit: 50 } });
        const rows: unknown = await res.json();
        const row = Array.isArray(rows) ? rows.find((r) => typeof r === 'object' && r !== null && 'id' in r && r.id === receiptId) : undefined;
        return row && typeof row === 'object' && 'currentVersion' in row && 'state' in row ? { version: row.currentVersion, state: row.state } : null;
      },
      { timeout: 20_000, message: `merchant-api stores v${version} (${state})` },
    )
    .toEqual({ version, state });
  await expect(page.getByTestId('sim-rejected')).toHaveText('0');
}

export async function qrUrlOf(page: Page): Promise<{ url: string; receiptId: string; secret: string }> {
  const url = (await page.getByTestId('sim-qr-url').textContent())?.trim() ?? '';
  const m = /^http:\/\/localhost:3001\/r\/([0-9a-f-]{36})#(\S{20,})$/.exec(url);
  expect(m, `QR url ${url}`).not.toBeNull();
  return { url, receiptId: m?.[1] ?? '', secret: m?.[2] ?? '' };
}
