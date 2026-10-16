import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E against the real stack: the apps started by `pnpm dev` (turbo run dev --parallel). `e2e/global-setup.ts`
 * reuses a stack that is already running and otherwise starts `pnpm dev` itself, then waits until every service is ready.
 * `channel: 'chromium'` = the full Chromium build (the installed revision), not the headless shell.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1280, height: 900 } } }],
});
