# Findings: merchant-web, dashboard-core, browser terminal

## Verification log

All commands run from the repo root against the docker-compose Postgres (5433), Mailpit and S3 mock. Counts are copied from the output.

| Command | Result | Counts |
|---|---|---|
| `pnpm --filter @lr/dashboard-core test` | PASS | 6 files, 29 tests (auth/TOTP 7, roles+enforcement 6, terminals 3, reports 6, archive+RLS 4, exports 2, key provider 1) |
| `pnpm --filter @lr/dashboard-core typecheck` | PASS | exit 0 |
| `pnpm --filter @lr/merchant-web test` | PASS | 2 files, 13 tests (env validation 3; Nitro server over HTTP 10) |
| `pnpm --filter @lr/merchant-web typecheck` (`nuxt typecheck`) | PASS | exit 0 |
| `pnpm --filter @lr/merchant-web build` (`nuxt build`) | PASS | "Build complete" |
| `cd packages/terminal-sdk && vitest run` | PASS | 7 files, 117 tests (mine: `idb-store.test.ts`, 7 tests; the rest are other agents') |
| `pnpm --filter @lr/terminal-sdk typecheck` / `@lr/crypto typecheck` | PASS | exit 0 |
| `pnpm --filter @lr/crypto test` | PASS | 1 file, 17 tests (RFC 8032 / 8785 / 9562 oracles unchanged after the isomorphic rewrite) |
| `pnpm lint` | PASS | no output after `eslint .` |
| `pnpm test:journey` | PASS | 6 hops, "Journey passed" |
| Manual smoke: real merchant-api (port 4101) + `nuxt dev --port 3100` + headless Chromium | PASS | see below |
| Production build smoke: `node .output/server/index.mjs` (NODE_ENV=production), Chromium loads `/dashboard/login` and `/simulator` under the CSP | PASS | HTTP 200, CSP header present, 0 console/page errors |

### Browser smoke (throwaway script, removed afterwards)

Fresh migrated database, owner created with `createMerchantUser`, then in Chromium:
login → TOTP enrol (otpauth URI + secret shown, code from `otpauth`) → archive; terminals page: generate keypair, create terminal, API key shown (43 chars), gone after dismiss and after reload, revoke (two-step) → status `revoked`; simulator: "Set up demo terminal" → 2×koffie + bier → Present → QR rendered at 576×576 px (1280×900 window) with the URL as text → Pay cash (rounding €0,01, total €10,70) → outbox drains to 0; Offline toggle on → 3 card sales queued → off → outbox drains; archive shows 4 receipts, the oldest has 2 versions, PDF download is `application/pdf` starting `%PDF-`; reports show the day row (4 receipts, €25,54 gross, €21,72 net, €3,82 BTW, rounding €0,01); an export request is `queued`; users, organisation (KvK shown) and locations pages load; logout. Console errors: none. Server side of the same run: 4 receipts (v2 + three v1), audit rows `terminal_key_created` ×2 and `terminal_key_revoked` ×1.

### What the automated tests cover

- **Auth:** wrong password and unknown email both fail; TOTP enrol (wrong first code does not enrol; seed stored encrypted `v1.…`, never plaintext); verify path on the next login; password-only session is not an actor; pre-MFA expiry at 10 min, full session 12 h (injected clock); token stored as sha256; logout; enrolment token bound to its session; 5 wrong codes delete the session and write `dashboard_mfa_failed` without the email; sessions resolve only to their own org; KeyProvider round trip, wrong-length key rejected, tampered ciphertext rejected.
- **Roles:** the permission table; accountant gets reads + export request and `ForbiddenError` from every write/user/terminal function; manager can run locations but not org settings or users; last owner cannot be demoted/deleted; cross-org user ids are `not_found`. Same matrix checked again over HTTP (accountant 403s).
- **Terminals:** key returned once, only `sha256` stored (checked in the DB row and in the list output), public key validated (6 bad shapes), other org's location refused, revoke sets `revoked_at` (seen through merchant-api's `authenticate_terminal`), both audit events present without the key, and a revoked key makes merchant-api answer 401 to the browser-path SDK (dead-lettered, not retried).
- **Reports:** seven sales built with the real terminal SDK and hand-computed expected values (daily and monthly rows, BTW per rate with per-receipt rounding, cash rounding +1, a void, a presented-only bill excluded, an Amsterdam midnight boundary: 23:30 UTC on 31 March counts on 1 April); other org's sale never appears; `vatByDay` agrees.
- **Archive/RLS:** filters (text, amount, date, state), versions, PDF bytes; org A cannot see org B by search, by id, or by raw SQL; no org context shows zero rows; the `dashboard` role cannot `SELECT` any `buyer.*` table (7 tables).
- **Exports:** request enqueues `export` with `{exportId}`; link appears only for `done` + `s3_key` with `X-Amz-Expires=86400`; other org sees none; kind/period validated.
- **IndexedDbStore:** the OutboxStore contract (Memory and IDB), reopen persistence with increasing `seq`, atomic commit (a failing second write leaves no receipt and no outbox row), and a real `TerminalSdk` queueing offline then flushing in one batch.
- **Server (built Nitro app, real Postgres, real merchant-api):** security headers, `no-store`, CSRF (foreign origin 403, no origin 403, `Sec-Fetch-Site: same-origin` ok), 401 on every endpoint without a session, cookie flags (HttpOnly, SameSite=Lax, Path=/), the whole login → enrol → data flow, `/sim-api` proxy (SDK through the proxy creates a receipt that shows up in the archive/report/PDF; non-`/v1` path 404), accountant/owner behaviour, pages served.

## Open

- **Playwright E2E is not written** (a later step). The flows exist and were smoke-tested by hand (above); the `data-testid`s are listed in `docs/decisions/merchant-web.md`. The accountant's browser UI (hidden nav items) was only checked at the HTTP level.
- **Concurrent `createTestDb()` can fail** with `error: tuple concurrently updated` at `ALTER ROLE … PASSWORD` in `packages/db/src/migrate.ts` when two test files migrate at the same time (seen once in `@lr/dashboard-core`). I avoided it for my packages with `fileParallelism: false`. Anything running several DB test files or packages in parallel (e.g. `turbo run test`) can hit it; the real fix is a Postgres advisory lock around the role-password step in `migrate`. Not changed (not my package).
- `pnpm --filter @lr/terminal-sdk test` was killed by the shell's 200 s limit once while other agents' suites were running at the same time; run directly it finishes in about 8 s (117 tests). Not reproduced.
- The export contract (`sales_csv`/`btw_csv`, `status` `done` + `s3_key`) was confirmed by the worker's author by message; I did not run an end-to-end export (dashboard request → worker → S3 → link). Export links are only tested against a stubbed job sender and a direct DB update.
- MFA lockout is per process and per session, TOTP code replay is not prevented, CSP keeps `'unsafe-inline'` for scripts, and the login rate limiter is in memory (all recorded as Deferred in `docs/decisions/merchant-web.md`).
- The simulator keeps the API key and signing key in `localStorage` by design (demo POS).
