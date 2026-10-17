import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { PNG } from 'pngjs';
import { adminDbUrl, loadEnv, s3EnvSchema } from '@lr/config';
import { createObjectStore } from '@lr/storage';
import { shot, walletLogin } from './support/browser.ts';
import { dbEnv, URLS } from './support/env.ts';
import { uniqueEmail } from './support/world.ts';

/**
 * Photo receipt end to end, in a real browser: upload from /add straight to S3 (cross-origin from :3001), the worker
 * reads it with the recorded extractor, the detail page shows lines with category and VAT, the buyer edits a category,
 * insights follow, and delete removes the row and the S3 object. MOCK corpus image, EXTRACTOR=recorded.
 */
const MOCK_DIR = fileURLToPath(new URL('../fixtures/receipts-nl/mock/', import.meta.url));
const IMAGE = `${MOCK_DIR}mock-supermarkt-statiegeld-bonus.png`;
const s3Env = loadEnv(s3EnvSchema);
const S3_ENDPOINT = s3Env.S3_ENDPOINT;
const s3 = createObjectStore(s3Env);

async function uploadRow(uploadId: string): Promise<{ s3_key: string } | undefined> {
  const c = new pg.Client({ connectionString: adminDbUrl(dbEnv) });
  await c.connect();
  try {
    return (await c.query<{ s3_key: string }>('select s3_key from buyer.uploads where id = $1', [uploadId])).rows[0];
  } finally {
    await c.end();
  }
}

async function login(page: Page): Promise<void> {
  await page.goto(`${URLS.wallet}/login`);
  await walletLogin(page, uniqueEmail('photo'));
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const uploadIdOf = (page: Page): string => new URL(page.url()).pathname.split('/').pop() ?? '';

test('photo receipt: upload from the wallet to S3, read, categories and VAT per rate, edit a category, insights, delete', async ({ page }) => {
  await login(page);
  await page.goto(`${URLS.wallet}/add`);
  await expect(page.getByTestId('upload-formats')).toContainText('PDF and HEIC');

  // --- upload: the bytes go from the browser straight to S3 (CORS between :3001 and :9090) ---
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().startsWith(S3_ENDPOINT));
  await page.getByTestId('file-input-library').setInputFiles(IMAGE);
  const stored = await put;
  expect(stored.status(), 'browser PUT to the S3 mock').toBe(200);
  await page.waitForURL(/\/uploads\/[0-9a-f-]{36}$/);
  const uploadId = uploadIdOf(page);

  // --- status: uploading → processing → done, shown as steps ---
  await expect(page.getByTestId('upload-status')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('upload-step-pending_upload')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('upload-step-processing')).toHaveAttribute('data-state', 'done');
  await expect(page.getByTestId('upload-step-result')).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('upload-done')).toBeVisible();

  // the object really is in S3
  const row = await uploadRow(uploadId);
  expect(row, 'upload row').toBeDefined();
  const key = row?.s3_key ?? '';
  expect((await s3.head(key))?.size, 'object in S3').toBe(readFileSync(IMAGE).length);

  // --- detail: shop, date, total, payment, lines with category and VAT rate, VAT per rate, photo ---
  await expect(page.getByTestId('upload-merchant')).toHaveText('Supermarkt De Hoek');
  await expect(page.getByTestId('upload-date')).toContainText('2026');
  await expect(page.getByTestId('upload-total')).toHaveText('€19.73');
  await expect(page.getByTestId('upload-payment')).toHaveText('Card');
  const lines = page.getByTestId('upload-line');
  await expect(lines).toHaveCount(8);
  await expect(lines.nth(0)).toHaveAttribute('data-category', 'boodschappen');
  await expect(lines.nth(0)).toHaveAttribute('data-vat-rate', '9');
  await expect(page.getByTestId('line-vat-0')).toContainText('9%');
  await expect(lines.nth(2)).toHaveAttribute('data-category', 'dining');
  await expect(lines.nth(4)).toHaveAttribute('data-category', 'dining'); // Cola 1,5L
  await expect(lines.nth(4)).toHaveAttribute('data-vat-rate', '21');
  await expect(lines.nth(6)).toHaveAttribute('data-category', 'huishouden'); // Wasmiddel
  await expect(lines.nth(7)).toHaveAttribute('data-category', 'statiegeld');
  await expect(page.getByTestId('line-vat-7')).toContainText('No VAT');
  await expect(page.getByTestId('upload-vat-row')).toHaveCount(2);
  await expect(page.locator('[data-testid="upload-vat-row"][data-rate="21"]')).toContainText('€1.90');
  await expect(page.locator('[data-testid="upload-vat-row"][data-rate="9"]')).toContainText('€0.68');
  const photo = page.getByTestId('upload-photo');
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0))).toBeGreaterThan(0);
  // a tall viewport instead of fullPage: the bottom tab bar is fixed and would be drawn in the middle of a full-page capture
  await page.setViewportSize({ width: 1280, height: 1700 });
  await shot(page, 'photo-upload-detail');
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- the buyer moves the cola from "Food & drink" to "Groceries" ---
  await page.getByTestId('line-category-4').selectOption('boodschappen');
  await expect(lines.nth(4)).toHaveAttribute('data-category', 'boodschappen');
  await expect(lines.nth(4)).toHaveAttribute('data-user-category', 'boodschappen');
  await expect(page.getByTestId('line-edited-4')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('upload-line').nth(4)).toHaveAttribute('data-user-category', 'boodschappen');

  // --- insights follow the stored categories; VAT per rate ---
  await page.goto(`${URLS.wallet}/insights`);
  const categories = page.getByTestId('chart-categories');
  await expect(categories).toContainText('€9.75'); // Groceries: 5.97 + the cola 3.78
  await expect(categories).toContainText('€4.49'); // Food & drink: 5.99 - 1.50 bonus
  await expect(categories).toContainText('€4.99'); // Household
  await expect(categories).toContainText('€0.50'); // Deposit
  const vat = page.getByTestId('chart-vat');
  await expect(vat).toContainText('21% VAT');
  await expect(vat).toContainText('€1.90');
  await expect(vat).toContainText('€0.68');
  await expect(vat).toContainText('0% VAT');
  await page.setViewportSize({ width: 1280, height: 1300 });
  await shot(page, 'photo-insights');
  await page.setViewportSize({ width: 1280, height: 900 });

  // --- the receipts list: the category filter also finds photo receipts ---
  await page.goto(`${URLS.wallet}/receipts`);
  await expect(page.getByTestId('upload-item')).toHaveCount(1);
  await page.getByTestId('toggle-filters').click();
  await page.getByTestId('filter-category').fill('huishouden');
  await expect(page.getByTestId('upload-item')).toHaveCount(1);
  await page.getByTestId('filter-category').fill('vervoer');
  await expect(page.getByTestId('upload-item')).toHaveCount(0);
  await page.getByTestId('filter-category').fill('');
  await expect(page.getByTestId('upload-item')).toHaveCount(1);

  // --- delete, with a confirm: the row and the S3 object are gone ---
  await page.getByTestId('upload-item').click();
  await page.waitForURL(new RegExp(`/uploads/${uploadId}$`));
  await page.getByTestId('delete-upload').click();
  await page.getByTestId('cancel-delete').click();
  expect(await uploadRow(uploadId), 'cancel keeps it').toBeDefined();
  await page.getByTestId('delete-upload').click();
  await page.getByTestId('confirm-delete').click();
  await page.waitForURL(`${URLS.wallet}/receipts`);
  await expect(page.getByTestId('upload-item')).toHaveCount(0);
  expect(await uploadRow(uploadId), 'row deleted').toBeUndefined();
  expect(await s3.head(key), 'object deleted from S3').toBeNull();
  await page.goto(`${URLS.wallet}/insights`);
  await expect(page.getByTestId('no-insights')).toBeVisible();
});

test('PDF and HEIC are refused in the wallet before anything is uploaded', async ({ page }) => {
  await login(page);
  await page.goto(`${URLS.wallet}/add`);
  const calls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/me/uploads') || r.url().startsWith(S3_ENDPOINT)) calls.push(`${r.method()} ${r.url()}`);
  });
  for (const file of [
    { name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') },
    { name: 'receipt.heic', mimeType: 'image/heic', buffer: Buffer.from('ftypheic') },
  ]) {
    await page.getByTestId('file-input-library').setInputFiles(file);
    await expect(page.getByTestId('upload-error')).toContainText('PDF and HEIC');
    await expect(page.getByTestId('upload-error')).toContainText('JPEG, PNG or WebP');
  }
  expect(page.url()).toMatch(/\/add$/);
  expect(calls, 'no request to the API or to S3').toEqual([]);
});

test('a photo that cannot be read ends as failed, with the reason', async ({ page }) => {
  await login(page);
  await page.goto(`${URLS.wallet}/add`);
  // a MOCK receipt with one pixel changed: a real, tight receipt image (the wallet accepts it and uploads it as it is) that is not in the recorded set
  const image = PNG.sync.read(readFileSync(`${MOCK_DIR}mock-weegschaal.png`));
  image.data[0] = 250;
  const png = PNG.sync.write(image);
  await page.getByTestId('file-input-library').setInputFiles({ name: 'unknown.png', mimeType: 'image/png', buffer: png });
  await page.waitForURL(/\/uploads\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('upload-status')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('upload-failed')).toBeVisible();
  await expect(page.getByTestId('upload-failed-reason')).not.toBeEmpty();
  await expect(page.getByTestId('upload-step-result')).toContainText('Failed');
  // a failed upload can still be removed
  const uploadId = uploadIdOf(page);
  await page.getByTestId('delete-upload').click();
  await page.getByTestId('confirm-delete').click();
  await page.waitForURL(`${URLS.wallet}/`);
  expect(await uploadRow(uploadId)).toBeUndefined();
});

test('a photo that needs review: the correction form has a category per line, the buyer’s choice survives the correction', async ({ page }) => {
  await login(page);
  await page.goto(`${URLS.wallet}/add`);
  await page.getByTestId('file-input-library').setInputFiles(`${MOCK_DIR}mock-horeca-gemengd.png`);
  await page.waitForURL(/\/uploads\/[0-9a-f-]{36}$/);
  const uploadId = uploadIdOf(page);
  await expect(page.getByTestId('upload-status')).toHaveAttribute('data-status', 'needs_review');
  await expect(page.getByTestId('correction-form')).toBeVisible();
  await expect(page.getByTestId('upload-failures')).toContainText('gross_sum');
  await expect(page.getByTestId('corr-line')).toHaveCount(5);
  await expect(page.getByTestId('corr-line').nth(0)).toHaveAttribute('data-category', 'dining'); // Koffie
  await expect(page.getByTestId('corr-line-vat-0')).toContainText('9%');
  await expect(page.getByTestId('upload-photo')).toBeVisible();

  // the buyer files the coffee under transport, types the printed total (the OCR misread a digit) and saves
  await page.getByTestId('corr-line-category-0').selectOption('vervoer');
  await page.getByTestId('corr-gross').fill('43.80');
  await page.getByTestId('corr-submit').click();
  await expect(page.getByTestId('upload-status')).toHaveAttribute('data-status', 'done');
  const lines = page.getByTestId('upload-line');
  await expect(lines).toHaveCount(5);
  await expect(lines.nth(0)).toHaveAttribute('data-category', 'vervoer');
  await expect(lines.nth(0)).toHaveAttribute('data-user-category', 'vervoer');
  await expect(lines.nth(1)).toHaveAttribute('data-category', 'dining'); // Appeltaart: still the rules' choice
  await expect(lines.nth(1)).toHaveAttribute('data-user-category', '');
  await expect(page.getByTestId('upload-total')).toHaveText('€43.80');

  await page.getByTestId('delete-upload').click();
  await page.getByTestId('confirm-delete').click();
  await page.waitForURL(`${URLS.wallet}/`);
  expect(await uploadRow(uploadId)).toBeUndefined();
});
