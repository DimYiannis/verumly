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

/** Service worker state as seen from the page, for failure messages. */
async function serviceWorkerDiagnostics(page: Page): Promise<string> {
  try {
    const info = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        registration: registration !== undefined,
        installing: registration?.installing?.state ?? null,
        waiting: registration?.waiting?.state ?? null,
        active: registration?.active?.state ?? null,
        controller: navigator.serviceWorker.controller !== null,
      };
    });
    return JSON.stringify(info);
  } catch (error) {
    return `diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Waits until the service worker controls the page. A page loaded before the worker activated is only controlled after the next
 * navigation, so if it is still uncontrolled once a worker is active, the page is reloaded once. Failure reports the registration state.
 */
export async function waitForServiceWorkerControl(page: Page, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  try {
    await page.evaluate(async (ms) => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('serviceWorker.ready timed out')), ms)),
      ]);
    }, timeoutMs);
    if (await page.evaluate(() => navigator.serviceWorker.controller === null)) await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: Math.max(deadline - Date.now(), 1_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`The page never came under service worker control (${reason}). Service worker state: ${await serviceWorkerDiagnostics(page)}`, {
      cause: error,
    });
  }
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
