import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devices, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { clearMailFor, mailpitCode } from './mailpit.ts';

const screenshotDir = fileURLToPath(new URL('../../docs/e2e-screenshots/', import.meta.url));

/** One named screenshot per key step, kept in the repo (`docs/e2e-screenshots/<name>.png`). Transitions are finished first. */
export async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${name}.png`, animations: 'disabled' });
}

/**
 * A phone: Playwright's `iPhone 13` descriptor (viewport, DPR, touch, mobile UA). The descriptor names WebKit as its browser,
 * only Chromium is installed here, and `newContext` ignores that field, so the emulation runs on Chromium.
 */
export async function newPhone(browser: Browser): Promise<BrowserContext> {
  const { defaultBrowserType: _webkit, ...iphone13 } = devices['iPhone 13'];
  return browser.newContext(iphone13);
}

/** Wallet `/login`: e-mail, then the 6-digit code that Mailpit received. Ends back on the page the login returns to. */
export async function walletLogin(page: Page, email: string): Promise<void> {
  await clearMailFor(email);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-send').click();
  await expect(page.getByTestId('login-info')).toBeVisible();
  await page.getByTestId('login-code').fill(await mailpitCode(email));
  await page.getByTestId('login-verify').click();
}
