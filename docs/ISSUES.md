# Issue tracker

Big issues found in the code review (2026-10-16) and still open. Tick an item when it is fixed **and** a test that failed before now passes. Supabase and hosting work is in `docs/SUPABASE-CHANGES.md`.

**P0** = fix before any real user or pilot. **P1** = correctness bugs. **P2** = needs a product or spec decision. **P3** = smaller fixes.

## P0: security and privacy (before any real user)

- [ ] **#1 BLOCKER: photo match lets anyone claim a receipt without its secret.**
  - **Where:** `apps/buyer-api/src/routes/uploads.ts:80-129`, `packages/db/src/matching.ts:24-46`
  - **Problem:** `PATCH /v1/me/uploads/:id` re-runs matching on the total and time the buyer typed in, as often as they like. Once it matches, `accept-match` claims the receipt. A photo (or fake) showing a café's public KvK number is enough to sweep totals and time windows and take strangers' unclaimed receipts. Each hit also reveals the merchant, total and time.
  - **Fix:** match only on what the OCR read, never on buyer corrections. Rate-limit PATCH. Better still, a photo match only *suggests* the receipt and the claim still needs the secret.
- [ ] **#2 Login codes can be brute-forced.**
  - **Where:** `apps/buyer-api/src/routes/auth.ts:53-66`, `app.ts:44`
  - **Problem:** the 5-attempt limit reads the counter and increments it in separate steps, so parallel requests all see 0 attempts. The `/v1/auth/*` routes also have no per-IP limit. This allows account takeover.
  - **Fix:** a single atomic `UPDATE … SET attempts = attempts + 1 WHERE attempts < 5 … RETURNING` before comparing, plus `@fastify/rate-limit` on the auth routes.
- [ ] **#3 Error logs leak data.**
  - **Where:** both Fastify apps, `packages/config/src/index.ts:62-77`
  - **Problem:** there is no error handler. Database errors carry the query's values (user ID, receipt content, secret hash), and log redaction doesn't cover them. A crafted cursor or a NUL character in a field is enough to trigger one.
  - **Fix:** an error handler that logs only the error name, the Postgres error code and the status, plus rejecting NUL characters in input schemas.
- [ ] **#4 Job-queue tables are open to merchant-side roles.**
  - **Where:** `packages/db/src/migrate.ts:80-85`
  - **Problem:** `merchant_api` and `dashboard` can read, write and delete everything in `pgboss`. That means reading buyer upload jobs and worker error output, faking notification jobs, and deleting the retention schedule.
  - **Fix:** grants per role. Merchant roles may only add jobs to their own queues and may not read or delete. Add a test for it.
- [ ] **#5 The receipt secret comes back into browser history.**
  - **Where:** `apps/wallet/app/plugins/capture-fragment.ts`, `apps/wallet/app/utils/receipt-link.ts:43`
  - **Problem:** Nuxt's router stores `/r/<id>#<secret>` before the fragment is stripped, so pressing Back shows the secret again. The unit test `receipt-link.test.ts:59` locks this behaviour in.
  - **Fix:** strip the fragment through the router itself. Add an end-to-end step: tap Save to wallet, go back, and assert no `#`.
- [ ] **#6 Shared phone: the previous user's data stays behind.**
  - **Where:** `apps/wallet/app/utils/wallet.ts:44-118`, `usePush.ts`
  - **Problem:** when a session expires (any 401), pending claims and cached receipts stay. The next user's login claims them into the new account. Logout also leaves the push subscription active.
  - **Fix:** tie pending claims and the cache to the user ID, and wipe them when the session changes. On logout, unsubscribe from push and delete the subscription on the server.
- [ ] **#7 Development defaults switch on when `NODE_ENV` isn't set.**
  - **Where:** `packages/config/src/index.ts:21-28,92-100`, `apps/buyer-api/src/main.ts:18`, `apps/merchant-web/server/utils/env.ts`
  - **Problem:** without `NODE_ENV=production`, the apps fall back to development settings:
    - the push key pair committed to the repo
    - push to local addresses allowed
    - the public dashboard encryption key
    - insecure cookies
    - the `*_dev` database passwords

    No start script sets `NODE_ENV`.
  - **Fix:** require real secrets unless dev mode is switched on explicitly, and set `NODE_ENV=production` in the start scripts.
- [ ] **#8 Push endpoints can reach internal hosts (SSRF).**
  - **Where:** `apps/buyer-api/src/routes/push.ts:16-20`, `apps/worker/src/jobs/notify-version.ts:72`
  - **Problem:** any `https:` host is accepted, including private and internal addresses, and the worker POSTs to it.
  - **Fix:** allow only known push-service hosts, or block private and link-local address ranges.

## P1: correctness

- [ ] **#9 The lead threshold is compared as text: 3 uploaders count as at least 20.**
  - **Where:** `apps/worker/src/jobs/extract-upload.ts:41`
  - **Evidence:** confirmed on Postgres: `select $1 >= $2` with (3, 20) returns `true`. The tests only use thresholds below 10.
  - **Fix:** compare in JS or cast to `int`. Add a test with a threshold of 20.
- [ ] **#10 The till's offline queue can jam permanently.**
  - **Where:** `packages/schema/src/crf.ts:27,89`, `apps/merchant-api/src/ingest.ts`, `packages/terminal-sdk/src/sdk.ts:278-318`
  - **Problem:** three ways it gets stuck:
    - **Bad data:** a NUL character or an impossible date passes the schema, crashes the server with a 500, and the batch retries forever.
    - **Stale version:** a new version after a refused one gets `version_gap` forever.
    - **Any 401:** a wrong key, for example, dead-letters the whole queue.
  - **Fix:**
    - reject control characters and invalid dates in the schema
    - stop adding versions to a receipt after a refusal
    - on `unauthorized`, pause the uploader instead of dead-lettering
- [ ] **#11 Adding a real receipt breaks the tests and the seed.**
  - **Where:** `scripts/lib/corpus.ts:47`, `scripts/seed.ts:296`, worker tests
  - **Problem:** one real `*.truth.json` switches the whole corpus to real files. The worker tests look up mock IDs and fail, and the seed needs at least 3 receipts. This breaks the spec rule that "the code must not change when real files arrive".
  - **Fix:** the worker tests load `mock/` explicitly, and the seed falls back to mock receipts.
- [ ] **#12 The Qianfan extractor fails if you follow the docs.**
  - **Where:** `apps/worker/src/extractor.ts:82,94,112`, `tools/qianfan/serve.md:32`
  - **Problems:**
    - **URL mismatch:** `serve.md` says to give the base URL, but the code posts to the URL as given, so every upload fails.
    - **Wrong retries:** 408 and 429 are treated as permanent errors.
    - **Wrong revision:** the served model name is recorded as the model revision.
  - **Fix:** append the API path in code, or fix the doc. Retry on 408 and 429. Use `QIANFAN_REVISION`.
- [ ] **#13 The §5 receipt rules have no rejection tests.**
  - **Where:** merchant-api and terminal-sdk tests
  - **Problem:**
    - No test checks the server rejecting bad receipts (`payments_sum`, `deposit_vat`, `totals_vat`, `discount_sign`, `duplicate_line_no`, and so on).
    - No test covers the SDK's validation before signing.
    - The test data is built by the code under test.
  - **Fix:** one rejection test per rule at zero tolerance, plus an SDK test that an invalid draft is never queued.
- [ ] **#14 A version notification can be lost.**
  - **Where:** `apps/merchant-api/src/app.ts:112,128,147`
  - **Problem:** the job is queued after the receipt is saved. If queuing fails, the retry is treated as a replay and never queues it again.
  - **Fix:** queue the job inside the same transaction, or re-queue it on replay.
- [ ] **#15 A logged-in buyer's pending receipt is saved without the confirmation sheet.**
  - **Where:** `apps/wallet/app/pages/r/[id].vue:64`
  - **Problem:** a QR scanned by mistake gets claimed, and the real customer then gets 409.
  - **Fix:** `queue(false)` for server-side `pending`, and show the sheet once the receipt resolves.

## P2: decisions needed (spec-level open issues)

- [ ] **#16 `claimSecretHash` is not covered by the receipt signature.** Someone with database access could swap the hash. **Costly to change later**, because it changes the signature format. Decide before real receipts exist.
- [ ] **#17 The receipt's `terminalId`/`locationId` are not checked against the authenticated terminal.**
- [ ] **#18 Claim window time source:** it currently uses server `received_at`. Confirm, and decide what reports bucket by.
- [ ] **#19 No limit on how far the terminal's `createdAt` can differ from server time** (clock backdating).
- [ ] **#20 `resolve/view` stays readable after a claim:** anyone with a forwarded link can still see the receipt.
- [ ] **#21 The resolver reveals whether a receipt ID exists:** it answers `pending` instead of 404 for unknown IDs. This is a recorded departure, against the spec's "same 404" rule.
- [ ] **#22 Refused attempts from revoked terminals are not audit-logged,** and there is no way to replay dead-lettered versions.
- [ ] **#23 Hardening:**
  - rate limiters are in memory per process, so they reset on restart and aren't shared
  - TOTP codes can be replayed
  - the dashboard CSP keeps `'unsafe-inline'`, and the wallet has no CSP
  - RLS trusts `app.org_id`, which a connection can set itself, so it guards against bugs, not a compromised app

## Verification gaps (never tested for real)

- [ ] **No real receipt corpus.** All accuracy numbers are MOCK, and the per-rate BTW rounding rule hasn't been checked against real kassabonnen.
- [ ] **Never run against the real service:** a real Qianfan-OCR endpoint, real push to a phone, a real phone camera scanning the QR, and iOS/Safari (the tests run Chromium only).
- [ ] **Wallet screens without end-to-end tests:** upload/photo, insights, settings, push opt-in, PWA install, and the notification click.
- [ ] **Browser upload to S3:** needs a CORS rule. The local S3 mock doesn't enforce CORS, so this is unverified.
- [ ] **PDF and HEIC uploads** are refused by the HTTP extractor.
- [ ] **Journey step 6** calls the dashboard code in-process instead of over HTTP.

## Hosting and operations

- [ ] Supabase changes: see `docs/SUPABASE-CHANGES.md`.
- [ ] **boxd:**
  - turn off auto-hibernate on the worker's machine
  - run each app as a systemd service with auto-restart
  - deploy script
  - monitoring and alerts
  - one VM is a single point of failure
- [ ] **Email provider** for login codes (Mailpit is local only).
- [ ] **GPU host** for Qianfan-OCR (Modal, a Hugging Face endpoint or similar).
- [ ] **DPAs** with Supabase, boxd, the email provider and the GPU host.

## P3: smaller fixes

- [ ] **Description scrubber deletes dates:** `16-10-2026` is removed from item descriptions (`terminal-sdk/src/mapping.ts:36`).
- [ ] **Health lines not flagged:** lines that arrive with a category from the till are never flagged sensitive (`worker/src/jobs/categorise.ts:23`).
- [ ] **Old voids miss the rollup:** the rollup only recomputes the last 3 days (`worker/src/jobs/rollup-daily.ts:18-22`).
- [ ] **Retention isn't atomic:** rows are deleted before their S3 objects (`worker/src/jobs/retention.ts`).
- [ ] **Space in path:** the fixtures path breaks if the checkout path has a space (`worker/src/env.ts:4`).
- [ ] **Negative rounding undocumented:** rounding of negative halves (returns) has no test (`receipt-nl/src/money.ts`).
- [ ] **Auth runs after body parsing:** merchant-api checks the key after parsing the body, so unauthenticated callers get schema errors and can make the server do work (`merchant-api/src/app.ts:97`).
- [ ] **Secret printed in the simulator:** the full URL including the secret appears under the QR. That's fine for a demo, wrong for a customer display.
- [ ] **Docs:**
  - FINDINGS:80 credits the end-to-end test with a request check it doesn't run
  - several references point to a `docs/decisions/` folder that no longer exists
- [ ] **Leftover test data:** each E2E run adds 4 test organisations to the dev database.

## Deferred features (not bugs)

- NFC: simple stickers for the demo, NTAG 424 DNA with SUN, or the v2 pad
- native apps (a Capacitor wrapper around the Vue wallet)
- certified fiscal integration
- Open Banking matching
- bill splitting
- data products
- ERP connectors

## Multi-country (added with the legal setup and receipt designer)

- **P1: the receipt format is Netherlands-only.** `crf` in `packages/schema` hard-codes EUR, VAT rates 21/9/0, KvK (8 digits) and BTW-id (`NL..B..`) formats; `receipt-nl` and the terminal SDK validate the same way; `receipt_lines.vat_rate` is a `smallint`. An organisation whose country is not NL can complete the business setup but the simulator/terminal cannot sign receipts for it. To do: free-form company id and VAT id per country, decimal VAT rates (5.5, 8.1, 25.5), other currencies, country fiscal fields in `crf.fiscal`, and per-country validation from `@lr/compliance`.
- **P1: the legal research is unverified.** `packages/compliance` data was compiled from public and mostly secondary sources (first pass thin for LU, EE, CY, GR, SI, CZ, RO, LV, LT; second pass improved MT, LV, LT, SI, GR). No country was reviewed by a tax adviser. Retention years and standard VAT rates in the build script are indicative.
- **P2: fiscal devices are not integrated.** The setup collects what a country asks for (TSE serial, RT serial, ATCUD, etc.) but nothing prints, signs or reports it (DE TSE, IT RT, ES Verifactu, PT ATCUD/QR, HR/SI/SK/HU/PL real-time reporting, FR NF525).
- **P2: designer.** Blocks can be reordered only in the Layers list (not by dragging on the canvas). Templates are per organisation, not per location or per language.

## Friends, shares and splits

- **P2: no notifications.** A friend request, a share, a new split or a settled share does not trigger a push; people see changes when they open the Friends tab.
- **P2: invites are single use and expire after 30 days.** A general friend-invite link works once. Guest slots of a split get a fresh link on demand (the earlier one stops working).
- **P2: privacy review.** Sharing a receipt or splitting it shows the friend its items and total. There is no per-field redaction and no "unshare"; deleting a split removes the participants' access to it, and a share cannot be withdrawn yet. Handle search tells anyone whether a handle exists.
- **P3: no comments, no groups, no feed**, only 1:1 shares with emoji reactions and splits with up to 10 people. Currency is the receipt currency (EUR); no cross-currency settle-up.
