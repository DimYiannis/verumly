import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { loadEnv, s3EnvSchema } from '@lr/config';
import { shot, walletLogin } from './support/browser.ts';
import { URLS } from './support/env.ts';
import { phoneStylePhoto } from './support/photo.ts';
import { uniqueEmail } from './support/world.ts';

/**
 * Photo preparation in the wallet, in a real browser: a phone-style photo (a MOCK receipt laid on a wood-coloured table,
 * made in the page's canvas at test time) is cropped on the device before any request, and a photo that cannot be read
 * is declined with advice, without a single request to buyer-api or S3. EXTRACTOR=recorded replays by the hash of the
 * bytes, so a cropped photo has no recording: the upload must end `failed` with that reason, not hang.
 */
const MOCK = readFileSync(fileURLToPath(new URL('../fixtures/receipts-nl/mock/mock-horeca-gemengd.png', import.meta.url)));
const S3_ENDPOINT = loadEnv(s3EnvSchema).S3_ENDPOINT;
const FRAME = { width: 1800, height: 2400 };

async function login(page: Page): Promise<void> {
  await page.goto(`${URLS.wallet}/login`);
  await walletLogin(page, uniqueEmail('prep'));
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${URLS.wallet}/add`);
}

function photoFile(buffer: Buffer): { name: string; mimeType: string; buffer: Buffer } {
  return { name: 'phone.jpg', mimeType: 'image/jpeg', buffer };
}

test('a phone-style photo is cropped before upload; the upload row is created and, with no recording for the cropped image, ends failed with the reason', async ({ page }) => {
  await login(page);
  const photo = await phoneStylePhoto(page, MOCK, { frame: FRAME, receiptWidth: 560 });

  // hold the S3 PUT so the preview can be read before the page moves on to the upload page
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let putBytes = 0;
  await page.route(
    (url) => url.href.startsWith(S3_ENDPOINT),
    async (route) => {
      if (route.request().method() === 'PUT') {
        putBytes = route.request().postDataBuffer()?.length ?? 0;
        await held;
      }
      await route.continue();
    },
  );

  await page.getByTestId('file-input-library').setInputFiles(photoFile(photo));
  const preview = page.getByTestId('prep-preview');
  await expect(preview).toBeVisible();
  const width = Number(await preview.getAttribute('data-width'));
  const height = Number(await preview.getAttribute('data-height'));
  const bytes = Number(await preview.getAttribute('data-bytes'));
  await expect(preview).toHaveAttribute('data-cropped', 'true');
  // the receipt is 560 px wide in a 1800 x 2400 frame: the crop is about the receipt, not the table
  expect(width, 'cropped width').toBeGreaterThan(560);
  expect(width, 'cropped width').toBeLessThan(700);
  expect(height, 'cropped height').toBeLessThan(FRAME.height / 2);
  expect(bytes, 'uploaded bytes vs the photo').toBeLessThan(photo.length / 3);
  await expect(page.getByTestId('prep-info')).toHaveText(new RegExp(`^${width} x ${height} px, \\d+ KB$`));
  await expect(page.getByTestId('prep-error')).toHaveCount(0);
  await shot(page, 'wallet-photo-prep-preview');

  release();
  await page.waitForURL(/\/uploads\/[0-9a-f-]{36}$/);
  expect(putBytes, 'the S3 PUT carries the cropped file').toBe(bytes);

  // no recording for the cropped bytes: failed, with the reason, not stuck on "Reading"
  await expect(page.getByTestId('upload-status')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('upload-failed-reason')).toContainText('not in the demo set');
});

test('photos that cannot be read are declined on the phone: a message per problem, no request to buyer-api, no S3 PUT, and another photo can be chosen', async ({ page }) => {
  await login(page);
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/me/uploads') || r.url().startsWith(S3_ENDPOINT)) calls.push(`${r.method()} ${r.url()}`);
  });
  const frame = { width: 1512, height: 2016 };
  const cases = [
    { problem: 'too_blurry', photo: await phoneStylePhoto(page, MOCK, { frame, receiptWidth: 560, blur: 8 }), text: 'The photo is blurry. Hold the phone steady and tap to focus.' },
    { problem: 'too_small', photo: await phoneStylePhoto(page, MOCK, { frame, receiptWidth: 180 }), text: 'The receipt is too small in the photo. Move closer so it fills the frame.' },
    { problem: 'no_receipt', photo: await phoneStylePhoto(page, MOCK, { frame }), text: 'We could not find a receipt in this photo. Lay it flat on a plain surface, fill the frame with it and try again.' },
    { problem: 'too_dark', photo: await phoneStylePhoto(page, MOCK, { frame, receiptWidth: 560, brightness: 0.4 }), text: 'The photo is too dark. Use more light.' },
  ];
  for (const { problem, photo, text } of cases) {
    await page.getByTestId('file-input-library').setInputFiles(photoFile(photo));
    const error = page.getByTestId('prep-error');
    await expect(error).toHaveAttribute('data-problem', problem);
    await expect(error).toHaveText(text);
    await expect(page.getByTestId('prep-preview')).toHaveCount(0);
    await expect(page.getByTestId('prep-status')).toHaveCount(0);
    expect(page.url()).toMatch(/\/add$/);
  }
  await shot(page, 'wallet-photo-prep-declined');
  expect(calls, 'nothing was sent: no upload row, no S3 PUT').toEqual([]);

  // a file the browser cannot decode is declined too
  await page.getByTestId('file-input-library').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') });
  await expect(page.getByTestId('prep-error')).toHaveAttribute('data-problem', 'unreadable');
  expect(calls).toEqual([]);

  // the buyer stays on the page and can choose another photo: a good one goes through (a tight MOCK image is uploaded as it is)
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().startsWith(S3_ENDPOINT));
  await page.getByTestId('file-input-library').setInputFiles(fileURLToPath(new URL('../fixtures/receipts-nl/mock/mock-supermarkt-statiegeld-bonus.png', import.meta.url)));
  expect((await put).status()).toBe(200);
  await page.waitForURL(/\/uploads\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('upload-status')).toHaveAttribute('data-status', 'done');
});
