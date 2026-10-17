import { expect, type Page } from '@playwright/test';
import * as OTPAuth from 'otpauth';
import { URLS } from './env.ts';
import type { World } from './world.ts';

/** The code an authenticator app would show for `secretBase32` right now (SHA-1, 6 digits, 30 s: what the dashboard enrols). */
export function totpCode(secretBase32: string): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretBase32), algorithm: 'SHA1', digits: 6, period: 30 }).generate();
}

/** Password step, then TOTP: enrols the authenticator on the first login (reading the seed from the page), verifies on later ones. */
export async function loginDashboard(page: Page, world: World): Promise<void> {
  await page.goto(`${URLS.merchantWeb}/dashboard/login`);
  await page.getByTestId('login-email').fill(world.ownerEmail);
  await page.getByTestId('login-password').fill(world.ownerPassword);
  await page.getByTestId('login-submit').click();

  // the next step is the TOTP form; an error instead (wrong password, login rate limit) must fail with its message
  const nextStep = page.getByTestId(world.totpSecret === null ? 'totp-enrol' : 'totp-input');
  const loginError = page.getByTestId('login-error');
  await expect(nextStep.or(loginError)).toBeVisible();
  if (await loginError.isVisible()) throw new Error(`dashboard login refused: ${await loginError.textContent()}`);

  if (world.totpSecret === null) {
    const seed = page.getByTestId('totp-secret');
    await expect(seed.or(loginError)).toBeVisible(); // beginning the enrolment can be refused by the limiter too
    if (await loginError.isVisible()) throw new Error(`dashboard TOTP enrolment refused: ${await loginError.textContent()}`);
    const secret = (await seed.textContent())?.trim();
    expect(secret, 'enrolment shows the TOTP seed').toBeTruthy();
    world.totpSecret = secret ?? null;
  }
  if (world.totpSecret === null) throw new Error('no TOTP seed');
  await page.getByTestId('totp-input').fill(totpCode(world.totpSecret));
  await page.getByTestId('totp-submit').click();
  await expect(page.getByTestId('whoami')).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/overview$/); // /dashboard redirects to the overview
}
