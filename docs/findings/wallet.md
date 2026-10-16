# Wallet findings (`apps/wallet`)

## Verification log

| Command (cwd = repo root unless noted) | Result | Counts / observation |
|---|---|---|
| `pnpm --filter @lr/wallet test` | PASS | 6 test files, 83 tests passed, 0 failed (link parser, fragment stripping, pending-claim store on memory + IndexedDB via fake-indexeddb, retry/expiry logic, API client, upload flow/poll, push support detection, push payload, Dutch formatting/day grouping, Amsterdam time conversion) |
| `pnpm --filter @lr/wallet typecheck` (`nuxt prepare && nuxt typecheck && tsc -p tsconfig.sw.json && tsc -p tsconfig.test.json`) | PASS | 0 errors (vue-tsc over all `.vue`/`.ts` in `app/`; service worker; utils + tests) |
| `pnpm --filter @lr/wallet build` (`nuxt build && node scripts/check-build.ts`) | PASS | Nitro `node-server` preset built; PWA injectManifest precache 38+ entries; `check-build` asserted `.output/public/sw.js` (contains `notificationclick`, `showNotification`, precache entry `"url":"/"`, `_nuxt/` assets), `manifest.webmanifest` (icons present) and the 4 PNG icons: "wallet build check OK" |
| `npx eslint apps/wallet` | PASS | 0 problems |
| `pnpm lint` | FAIL (not wallet) | 1 error in `apps/worker/test/extract-upload.test.ts` (`'imageBytes' is defined but never used`), owned by another agent; earlier run also listed `apps/merchant-web/server/middleware/security.ts` (`no-useless-assignment`), gone in the later run. No wallet file reported. |
| `node apps/wallet/scripts/smoke.ts` (prod build served by `node .output/server/index.mjs` on :3001, real merchant-api + buyer-api on a throwaway DB, phone-sized full Chromium, 12 ✔ lines, 0 failed) | PASS | see "Smoke" below |
| `WALLET_MODE=dev node apps/wallet/scripts/smoke.ts` (`nuxt dev --port 3001`) | PASS | 7 ✔ lines (service-worker/offline/push steps are prod-only) |

## Smoke (what was actually observed)

Receipts created through the real `@lr/terminal-sdk` (`receiptHost` = `http://localhost:3001`, `presented`, 2×Koffie 9% + Bier 21%).

1. Logged out, open `/r/<id>#<secret>` → `presented-banner` reads "Geen definitieve bon / Not a final receipt", 2 `receipt-line`s, `save-to-wallet`, **no** `confirm-sheet`. `location.hash` is `''` and `page.url()` has no `#`. No captured request URL contains the secret.
2. Save → `/login?next=/r/<id>` → email code read from Mailpit → back on `/r/<id>` with the "Bon opslaan?" sheet showing Café Het Plein, € 10,69, time.
3. Save → `/receipts/<id>?saved=1`, banner + 2 BTW rows. Wallet `/` lists 1 `receipt-item`.
4. (prod) service worker controls the page; context offline → `/receipts/<id>` renders from the service-worker shell + IndexedDB (`cached-notice`, `offline-badge`, 2 lines).
5. (prod) offline, open a second receipt link → `arriving-state` (fragment stripped); `/` shows 1 `arriving-item`. Back online (`setOffline(false)` + `online` event) → the pending claim completes, no arriving items, wallet has 2 receipts.
6. (prod) SDK pays v3 cash → `/receipts/<id>` shows `final-badge`, no banner, rounding line, version history.
7. (prod) CDP `ServiceWorker.deliverPushMessage` with the worker's payload shape → the SW shows exactly one notification with title/body/tag=receiptId/data.
8. Add-receipt UI: file chosen → presign → PUT → complete → poll → `needs_review` correction form pre-filled (merchant, `19,99`) → PATCH → `match-offer` "Officiële bon gevonden — vervangen?" → `accept-match` → `/receipts/<id>`. **The upload endpoints were mocked with Playwright `page.route`** (the throwaway stack has no S3 or worker); this checks the UI, not buyer-api/S3/worker.
9. No console errors other than `Failed to load resource` caused by the deliberate offline phase.

Screenshots (not committed): `/tmp/wallet-smoke/{1-banner-readonly,2-confirm-sheet,3-saved-detail,4-wallet,5-offline-saved,6-arriving,7-arrived,8-final,9-correction-form,10-match-offer}.png`.

## Not verified / Open

- **Not exercised end to end against the real stack:** upload (presign → S3 PUT → complete → worker extraction → PATCH → accept-match), insights, consents, push subscribe, PDF download, export, account delete. buyer-api routes exist (`apps/buyer-api/src/routes/*`) and the client follows their shapes, but the wallet UI for these was only exercised through mocks (uploads) or not at all. The Playwright E2E step (§16.G) must cover them. Browser → S3 presigned PUT also needs the S3 endpoint to allow CORS from `RECEIPT_HOST` (s3mock config); untested.
- **`notificationclick` handler** (focus/navigate/openWindow) is not exercised: Chromium offers no CDP call to dispatch a click. Its target logic (`notificationTarget`) is unit-tested; the `push` handler is smoke-tested.
- **iOS / Safari** untested (no WebKit browser installed). The iOS detection (`detectPushSupport`) and the "Add to Home Screen" hint are unit-tested with user-agent fixtures only. Real push delivery to a device is not verified (also v2 §17).
- A 404 from `POST /v1/me/claims` (receipt not uploaded yet *or* wrong secret) is retried for the full 7 days by design; a wrong secret therefore sits in "Arriving" until it expires. The viewer itself drops the pending claim when `resolve/view` answers 404.
- The precached shell embeds the runtime config as of the last build / service-worker update; changing `NUXT_PUBLIC_BUYER_API` on a deployed server reaches installed PWAs only after the next SW update.
- No CSP header (needs the deployment's buyer-api and S3 origins); other security headers are set.
- `.vue` files are type-checked (vue-tsc) but not linted (no eslint-plugin-vue).
- `scripts/smoke.ts` imports `scripts/lib/harness.ts`, whose own typing does not pass under the wallet's `tsc` settings, so the smoke script is excluded from `tsconfig.test.json`; it is linted and runs under Node type stripping.
- Known open issues from the v2 handoff notes (claim secret hash not signed, terminal/location not compared, claim window clock) were not touched.
