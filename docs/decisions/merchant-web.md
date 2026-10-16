# Decisions: merchant-web, dashboard-core, browser terminal

Every departure from `coding-agent-prompt-v2.md` ("v2") is marked **DEPARTURE**.

## Dashboard auth (v2 §12, §14)

- Login is two steps. Step 1 (email + password, argon2id via `@node-rs/argon2`) creates a session row with `mfa_done = false` that lives **10 minutes** and can only be used to finish MFA. Step 2 (TOTP enrol or verify) flips `mfa_done` and gives the session its full **12 hour** lifetime. Session tokens are 32 random bytes, only sha256 is stored, lookups go through `merchant.find_dashboard_session`.
- Wrong email and wrong password are indistinguishable (a dummy argon2 verify runs for unknown emails).
- **TOTP enrolment is stateless until the first code is right.** `beginTotpEnrol` returns the seed (base32 + `otpauth://` URI) and an `enrolToken` = the seed encrypted with the KeyProvider and bound to the session hash (10 min). Nothing is written to `merchant_users` until `confirmTotpEnrol` verifies a code; the update only applies while `totp_secret_encrypted is null`. A user who abandons enrolment therefore stays "not enrolled".
- Anyone who knows a password for a not-yet-enrolled account can enrol their own authenticator (inherent to "enrol at first login"). Mitigation: owners create users with an initial password and hand it over; an owner can reset a user's authenticator (`resetUserTotp`, also deletes their sessions).
- Wrong codes: after **5** failures the pending session is deleted (counted in memory per process) and each failure writes `dashboard_mfa_failed` to `ops.audit_log` (user id, never email). A per-user lockout across processes is **not** built (Deferred).
- TOTP: SHA-1, 6 digits, 30 s, window ±1 step (`otpauth` 9). Code replay inside the window is not blocked (Deferred).
- Login and TOTP endpoints are limited to `LOGIN_RATE_LIMIT` (default 20) attempts per client IP per 5 minutes, in memory per process (same store decision as the buyer API: a shared store is a deployment decision).
- `KeyProvider` is an interface (`encrypt`/`decrypt`); `LocalKeyProvider` is AES-256-GCM with the env key `DASHBOARD_ENCRYPTION_KEY` (32 bytes base64), format `v1.<iv>.<tag>.<ct>`. A public **development** key is used when the variable is unset and `NODE_ENV != production`; in production the server refuses to start without it.

## Roles (v2 §7, §12)

- Permissions are a table (`ROLE_PERMISSIONS`), enforced by `requireRole(actor, permission)` **inside every dashboard-core function that takes an `Actor`**, and again at the HTTP handler. The Nuxt routes can therefore not forget the check.
  - owner: everything.
  - manager: archive, reports, exports, organisation (read), locations and terminals (read/write). **No** organisation settings and **no** user management. (v2 only names the three roles; this split is my choice.)
  - accountant: read-only: organisation, locations, archive, reports, exports (list **and request**; v2: "reads + exports only"). No terminals, no users.
- The last owner cannot be demoted or deleted, and a user cannot delete themselves.
- `searchArchive`, `getReceiptWithVersions`, `vatByDay` keep their old signatures (the journey uses them). They take an org id, not an actor, so the **HTTP handler** is what enforces `archive.read` for them.

## Reports

- `salesReport` is computed from the latest version of each receipt, not from `daily_rollups`, so it is correct before the rollup job runs. v2 allows "receipts/rollups".
- A receipt is counted on the Europe/Amsterdam day of its **latest version** (when it reached its final state). `paid` = sale, `void` = void (count and gross reported separately, excluded from sales/BTW), `open`/`presented` = neither.
- BTW per rate is the sum of the per-receipt `vatSummary` rows (each already rounded per receipt and rate), so it equals what was printed.
- I changed `vatByDay` to filter on the same date it groups by (the latest version). Before, it filtered by receipt creation and grouped by version time, which disagreed for a bill presented before midnight and paid after.

## Terminals

- The dashboard never generates the Ed25519 key: the caller supplies the 32-byte base64url **public** key (validated: exact alphabet, 43 chars, 32 bytes). The page offers "generate a keypair in this browser" and shows the private key once, client-side only.
- API key: 32 random bytes, returned once from the create call, sha256 stored. Audit: `terminal_key_created`, `terminal_key_revoked` (org, terminal, acting user id, label; never the key). Revoke is idempotent and audits only the first revoke.
- A terminal can only be created on a location the caller's org can see (RLS makes the lookup empty otherwise; the FK alone would accept another org's location id).
- Revoking has an inline two-step confirm (`terminal-revoke` → `terminal-revoke-confirm`), not `window.confirm`, so Playwright does not auto-dismiss it.

## Exports (contract with the worker)

- `merchant.exports.kind` ∈ `sales_csv` | `btw_csv`; the dashboard inserts `status = 'queued'` and then `boss.send('export', { exportId })` (after commit).
- The worker (confirmed by its author) sets `status` `processing` → `done` | `failed` and `s3_key`; it also writes `url`/`expires_at` (migration 0003), which the dashboard does not read. `listExports` presigns a **fresh 24 hour GET link every time the list is read** (the table has no expiry column), so "link valid 24 h" means 24 h from the moment you looked.

## Merchant web (Nuxt)

- Nuxt 4, Vue 3 `<script setup lang="ts">`, Tailwind 4 via `@tailwindcss/vite`, Nitro default node preset. `/dashboard/**` and `/simulator` are **client-rendered** (`ssr: false`): no cookie forwarding on SSR and no hydration mismatch with localStorage/IndexedDB.
- Workspace packages ship `.ts`; `nitro.externals.inline: [/^@lr\//]` bundles them into the server output (Node will not strip types under `node_modules`).
- Session cookie: `lr_dashboard`, httpOnly, SameSite=Lax, Path=/, 12 h; with `Secure` and the `__Host-` prefix when `DASHBOARD_COOKIE_SECURE` is true (default: true when `NODE_ENV=production`).
- CSRF for state-changing `/api/**` requests: SameSite=Lax **plus** an `Origin` check (must equal the request `Host`); a request with no `Origin` is accepted only with `Sec-Fetch-Site: same-origin`. 256 KiB body cap.
- Headers: nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP same-origin, restrictive Permissions-Policy, HSTS when cookies are Secure, `Cache-Control: no-store` on API responses. **DEPARTURE-ish:** the CSP is sent in production only (Vite's dev server needs eval and websockets) and keeps `script-src 'self' 'unsafe-inline'` / `style-src 'unsafe-inline'` because Nuxt writes an inline bootstrap script; nonces are Deferred.
- `/sim-api/**` is a same-origin proxy to `MERCHANT_API_URL` (default `http://127.0.0.1:4001`): only `/v1/**`, a header allowlist (`content-type`, `authorization`, `x-terminal-id`, `x-signature`, `idempotency-key`, `accept`), so the dashboard cookie never reaches merchant-api, and merchant-api needs no CORS. It is not CSRF-checked (it uses Bearer keys, not the cookie).
- Env is validated with zod (`loadEnv`) at server start (`server/plugins/env.ts`). `RECEIPT_HOST` is read at runtime through `GET /api/simulator/config`, not baked into the client bundle.

## Simulator

- Product grid buttons are the "Add item" action. While a bill is `presented`, tapping a product immediately sends a new `presented` version (live update). `Present` sends the cart as a presented receipt (or re-sends it). `Pay card` / `Pay cash` start a receipt directly at `paid` when none exists (v2 allows starting at paid). Cash uses the SDK's 5-cent rounding. `Void` voids the current receipt. `New sale` clears the cart. There is no Fiscalise button.
- Offline toggle: stops the SDK flusher and makes the SDK's `fetch` reject, like a dead network. Turning it off restarts the flusher; the outbox drains in order.
- The outbox is IndexedDB (`IndexedDbStore`, `@lr/terminal-sdk/idb`, `idb`): `commit` writes the receipt and the outbox item in one transaction and aborts both if either write throws (tested).
- "Set up demo terminal": needs a signed-in dashboard session; generates the keypair in the browser (`@lr/crypto`), registers the public key through the normal terminal API, and stores `{terminalId, apiKey, privateKey, merchant}` in `localStorage` (`lr.sim.terminal`). This is a demo POS: do not use real keys.
- The QR is the SDK's SVG, shown at `min(68vh, 36rem)` square (about 576 px at a 1280×900 window), with the URL printed below it as text (`sim-qr-url`).

## Shared package changes

- **`@lr/crypto` is now isomorphic.** It imported `randomBytes`/`timingSafeEqual` from `node:crypto` and used `Buffer`, which cannot run in the browser simulator. It now uses `globalThis.crypto.getRandomValues`, a manual constant-time compare of the two sha256 digests, and `btoa`/`atob` when `Buffer` is missing. Behaviour and exports are unchanged (17 crypto tests, incl. the RFC vectors, still pass).
- `@lr/terminal-sdk` gets the `./idb` export, `idb` as a dependency, `fake-indexeddb` as a dev dependency, and `lib: DOM` in its tsconfig (for the IndexedDB types).

## data-testid reference

Login: `login-email`, `login-password`, `login-submit`, `login-error`, `totp-enrol`, `totp-secret`, `totp-uri`, `totp-input`, `totp-submit`.
Layout: `nav-archive|reports|exports|organisation|locations|terminals|users|simulator`, `whoami`, `logout`, `error` (inline error on every page).
Organisation: `org-legal-name`, `org-kvk`, `org-vat`, `org-retention`, `org-save`, `org-saved`.
Locations: `location-row`, `location-name|address|postcode`, `location-add`, `location-edit`, `location-edit-name`, `location-save`, `location-delete`.
Terminals: `terminal-label`, `terminal-location`, `terminal-public-key`, `terminal-generate`, `terminal-private-key`, `terminal-create`, `terminal-created`, `terminal-key` (the API key, once), `terminal-id`, `terminal-key-dismiss`, `terminal-row` (`data-terminal-id`), `terminal-label-cell`, `terminal-status` (`active`/`revoked`), `terminal-revoke`, `terminal-revoke-confirm`.
Archive: `archive-q`, `archive-state`, `archive-from`, `archive-to`, `archive-amount`, `archive-search`, `archive-refresh`, `archive-table`, `archive-row` (`data-receipt-id`, `data-state`), `archive-link`, `archive-state-cell`, `archive-total`, `archive-empty`, `archive-prev`, `archive-next`; detail: `archive-detail-id`, `archive-detail-state`, `archive-version` (`data-version`), `archive-line`, `archive-vat`, `archive-version-total`, `archive-pdf`.
Reports: `report-from`, `report-to`, `report-granularity`, `report-location`, `report-run`, `report-sales-row` (`data-period`), `report-vat-row` (`data-period`, `data-rate`), `report-total`, `report-empty`.
Exports: `export-kind`, `export-from`, `export-to`, `export-request`, `export-row` (`data-status`), `export-status`, `export-link`.
Users: `user-row`, `user-email`, `user-role`, `user-reset-totp`, `user-delete`, `user-new-email`, `user-new-password`, `user-new-role`, `user-create`.
Simulator: `sim-setup-panel`, `sim-setup`, `sim-error`, `sim-add-koffie|appeltaart|bier|wijn`, `sim-cart`, `sim-cart-line`, `sim-rounding`, `sim-total`, `sim-state`, `sim-version`, `sim-present`, `sim-void`, `sim-pay-card`, `sim-pay-cash`, `sim-new-sale`, `sim-offline-toggle` (checkbox), `sim-pending` (polled every 400 ms, so it can lag a click), `sim-rejected`, `sim-network`, `sim-terminal-id`, `sim-reset`, `sim-qr` (the SVG container), `sim-qr-url`, `sim-qr-placeholder`, `sim-dashboard-link`.

## Deferred (from this slice)

- Per-user, cross-process MFA lockout; TOTP code replay protection; password change / reset by email; CSP nonces; a shared rate-limit store.
