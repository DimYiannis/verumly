# Findings

Everything numeric below comes from commands that were run in this repository; nothing is estimated. Numbers computed from the mock corpus are labelled **MOCK**.

## Open

Known open issues carried over from the v2 Handoff notes, deliberately **not** fixed (pinned by `apps/merchant-api/test/open-issues.test.ts`):

1. `claimSecretHash` is not covered by the receipt signature.
2. The server does not check that `merchant.terminalId` / `locationId` in the receipt match the authenticated terminal (the DB columns come from the authenticated terminal).
3. It is undecided whether the claim window uses terminal time or server time. Server `received_at` is used.

Found during the build and still open (details in the per-area sections below):

4. `/v1/resolve/view` keeps returning the full receipt to anyone holding the link after it is claimed (product decision).
5. No bound on terminal-supplied `createdAt` (clock backdating); archive/report bucketing by that date is untested.
6. Revoked-terminal requests are not audit-logged. The SDK dead-letters refused versions but has no replay.
7. **Accept-match is a claim without the secret** (v2 §11 design): limited to unclaimed receipts with the same total in a 30-minute window, but not abuse-tested.
8. The `http` extractor was only run against a stub, never a real Qianfan endpoint; PDF and HEIC uploads are refused by it (`pdf_unsupported`, `unsupported_file`).
9. **Not verified by this repo:** a real phone camera scanning the QR; real push delivery to a device (push was received and decrypted by a local endpoint); iOS/Safari (the `iPhone 13` descriptor runs on Chromium; no WebKit installed); `notificationclick`; browser PUT to S3 (needs a CORS rule for RECEIPT_HOST); the wallet's upload, insights, consents, export and delete-account UIs end to end (uploads were exercised with mocks in the wallet smoke; the API side is tested against real Postgres/S3).
10. No real corpus exists: the §5 per-rate VAT rounding rule is untested against real receipts, and the extraction accuracy numbers are **MOCK**. `known-misfits.json` is `[]` because no mock receipt genuinely misfits.
11. `scripts/journey.ts` hop 6 calls `@lr/dashboard-core` in-process rather than the dashboard over HTTP (the dashboard over HTTP is covered by Playwright scenarios 3 and 4). See DECISIONS.
12. Per-process in-memory limiters (resolver per-IP, dashboard login/TOTP: 20 per IP per 5 minutes, so more than two E2E runs in 5 minutes against one running stack can trip it); MFA lockout is per process; TOTP replay is not prevented; the production CSP keeps `'unsafe-inline'` for scripts; the wallet sets no CSP.
13. RLS trusts `app.org_id`, which a connection can set itself: it guards against application bugs, not a compromised merchant-api/dashboard process.
14. MinIO images could not be pulled; S3 is `adobe/s3mock`, which does not enforce signed lengths or CORS.

## Verification log

### Final clean-clone run (after the last code change; commit `339a904`)

`git clone git@github.com:DimYiannis/less-receipts.git /tmp/lr-clean && pnpm install --frozen-lockfile && pnpm db:migrate`, then:

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS, exit 0 |
| `pnpm typecheck` | PASS, 24 tasks successful |
| `pnpm test` | PASS, exit 0, 23 tasks successful. Counts seen: crypto 17, schema 2, receipt-nl 173, wallet 83, terminal-sdk 119, merchant-api 116, worker 56, db 70, dashboard-core 29, merchant-web 13 (buyer-api: 75 in the preceding working-tree run, same code) |
| `pnpm build` | PASS, 13 tasks successful (two real `nuxt build`s; wallet output includes `sw.js` and `manifest.webmanifest`, asserted by its build check) |
| `pnpm test:journey` | PASS, 6 hops |
| `pnpm test:privacy` | PASS, 0 hits in 35 needle×haystack searches, 6 controls ok |
| `pnpm eval:extraction` | PASS, MOCK corpus: 4 done, 2 needs_review, 0 false done |

The first clean-clone run (commit `1030c88`) **failed** one test: `privacy-canary` ran `docker compose exec` from the clone's directory, where no compose project exists. Fixed in `339a904` (find the container by published port) and re-run as above.

### Final Playwright check (DIRECTIONS §6a), run last

Reset: `docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed` (seed: 201 receipts, 30 claims, 3 uploads, 2 terminals). Stack: `pnpm dev` (all five services healthy). Command: `pnpm test:e2e` (`playwright test`, `trace: 'on'`, `screenshot: 'on'`, `video: 'retain-on-failure'`, html + list reporters).

**Result: PASS, 4 passed, 0 failed, 22.0 s** (23 s wall):

| Scenario | Time |
| --- | --- |
| buyer journey on a phone (`iPhone 13` descriptor): issued receipt, login, save, fragment gone, void, exactly one encrypted push | 12.7 s |
| buyer offline: link opens as "Arriving", claim completes online, saved receipts render offline | 1.2 s |
| dashboard: TOTP login, create terminal, key shown once, revoke | 2.1 s |
| merchant offline: 3 offline sales all reach the dashboard archive | 2.9 s |

HTML report: `docs/e2e-report/index.html`. Screenshots in `docs/e2e-screenshots/`: `qr-on-simulator`, `receipt-on-phone`, `save-receipt-sheet`, `wallet-with-receipt`, `voided-receipt`, `arriving-state`, `dashboard-archive`.

### Step 1 — walking skeleton

| Command | Result |
| --- | --- |
| `pnpm --filter @lr/crypto test` | PASS — 17 passed, 0 failed (RFC 8032 §7.1: 5 vectors × public key/signature/verify; RFC 8785: 6 cyberphone data files; UUIDv7 bits; secrets; sign/verify) |
| `pnpm test:journey` | PASS — 6 hops (1 offline create + QR, 2 pending, 3 flush + preview, 4 Mailpit login + claim + wallet, 5 v3 paid final + 2 notify-version jobs, 6 archive + VAT 9% 680/624/56 and 21% 389/321/68) |
| `pnpm lint` | PASS — no output, exit 0 |
| `pnpm typecheck` | PASS — 14 tasks successful |
| `pnpm test` | PASS — 14 tasks successful (only `@lr/crypto` has tests at this step) |

### Per-area logs

The agents' own verification logs are in the per-area sections below (each starts with a "Verification log" table).

## Threat list (v2 §15)

| Threat | Test or measurement | Result |
| --- | --- | --- |
| Shoulder-surfed or photographed QR at the till | `buyer-api/test/threats.test.ts` | Whoever claims first owns the receipt; the real customer then gets 409. 256-bit secret; the failed-secret limit does not help (the secret is correct). **Accepted risk, no second factor.** |
| Shared or forwarded receipt link | `threats.test.ts`, `resolve.test.ts` | After a claim a second user cannot add it (409, not in their wallet), but `resolve/view` still shows the receipt to any link holder. Open (item 4). |
| Secret left in browser history or a share sheet | E2E buyer journey (`location.hash` empty and no request URL contains the secret after load); `logging.test.ts`; canary | The fragment is stripped with `history.replaceState`; the secret appears only in POST bodies. A link already shared or in a share sheet before the page loads is **uncovered**. |
| Claim race | `claims.test.ts › claim race` | 16 parallel claimers: one 201, fifteen 409, one row (`claims.receipt_id` is the primary key). |
| Terminal clock backdating | `threats.test.ts` | `claimable_until` uses server `received_at`; `createdAt` is stored as sent with no skew bound. Open (item 5). |
| Versions signed offline before a key was revoked | `terminal-sdk/test/server.test.ts` | Revocation is checked at upload: queued versions get 401 and are dead-lettered; versions accepted before the revoke stay. No audit entry for refused attempts (item 6). |
| Free text that could carry identifiers | `merchant-api/test/freetext.test.ts`, `terminal-sdk/test/mapping.test.ts`, privacy canary | Unknown keys and descriptions over 80 chars are rejected; the SDK scrubs masked PANs and long digit runs. **A name typed into a description cannot be detected** (residual channel, tests pin stored-as-sent). |
| Buyer data on the merchant side | `packages/db/test/roles.test.ts`, `pnpm test:privacy` | Merchant roles cannot SELECT `buyer.*`/`leads.*`; RLS isolates orgs; canary email, secret, user id and session token have 0 hits in logs, merchant/ops/pgboss dumps and every merchant-side response (positive controls proven). |
| Accept-match without the secret | worker tests (match flow only) | Uncovered for abuse. Open (item 7). |

# Findings by area

The sections below were written by the agent that built each area.

## Findings: corpus, parser, extraction eval (fragment)

**Everything below is computed from the MOCK corpus (6 synthetic kassabonnen I authored). It is not a real accuracy measurement.** Corpus used: `fixtures/receipts-nl/mock/` (no real `*.truth.json` exists yet).

## Verification log

| Command | Result | Counts |
|---|---|---|
| `node scripts/render-mock-corpus.ts` (run twice, `shasum` of the PNGs compared) | PASS | 6 receipts; identical SHA-256 on both runs |
| `pnpm --filter @lr/receipt-nl test` | PASS | 6 files, 173 tests (this fragment's files: corpus 22, eval 11, parse 25, primitives 51, tools 2; plus the existing lifecycle 62) |
| `pnpm --filter @lr/receipt-nl typecheck` | PASS | tsc clean (includes `test/` and the `scripts/lib` files they import) |
| `pnpm eval:extraction` | PASS | exit 0; 6 evaluated, 4 done, 2 needs_review, 0 false done |
| `pnpm exec eslint packages/receipt-nl scripts` | PASS | 0 problems |
| `pnpm lint` (whole repo) | FAIL, not mine | 2 errors in other agents' in-progress files: `apps/merchant-web/server/middleware/security.ts` (`no-useless-assignment`) and `apps/worker/test/extract-upload.test.ts` (unused `imageBytes`); 0 in files owned by this fragment |
| `tsc -p` on a temp tsconfig covering `scripts/render-mock-corpus.ts`, `eval-extraction.ts`, `lib/{corpus,eval,mock-receipts}.ts` | PASS | no errors (temp file removed) |

(`pnpm <script>` also prints an `ERR_PNPM_OUTDATED_LOCKFILE` verify-deps warning while other agents' package.json edits are unlocked; it does not stop the script.)

## Corpus misfits (Test C)

`fixtures/receipts-nl/known-misfits.json` is `[]`. Actual misfits on the mock corpus: **none** (MOCK). This says nothing about real receipts: the mock numbers were written under the §5 rule, so agreement with the rule is by construction. The check that matters (does the printed VAT on real kassabonnen follow per-rate rounding, or per-line?) is **still open** until real `*.truth.json` files arrive; Test C will report it as `vat:<rate>` misfits.

## Line-kind coverage (Test C)

| Kind | Mock receipt that passes | Status (MOCK) |
|---|---|---|
| statiegeld | `mock-supermarkt-statiegeld-bonus` | covered |
| bonus | `mock-supermarkt-statiegeld-bonus` | covered |
| weighed | `mock-weegschaal` (0,350 kg × 7,10 tie → 2,49) | covered |
| cash rounding | `mock-contant-afronding` (12,37 → −0,02) | covered |
| return | `mock-retour` (−1 × 1.249,00) | covered |

Uncovered: none on mock. Not covered by any receipt (mock or otherwise): 0% VAT rows, multi-payment receipts, tips, receipts with a `printedBase` basis `incl` on a deposit, drogist/apotheek lines, photos (the mock PNGs are clean renders, so Qianfan on real photos is untested).

## Extraction eval (Test D / `pnpm eval:extraction`) — **MOCK**

MOCK CORPUS — not a real accuracy measurement. Recorded outputs are simulated (`modelRevision: "mock"`), so they contain only the two errors I planted.

| Field (**MOCK**) | Correct | Total | Accuracy |
|---|---|---|---|
| merchant key | 6 | 6 | 100% |
| date/time | 6 | 6 | 100% |
| gross | 5 | 6 | 83% |
| VAT per rate | 5 | 6 | 83% |
| payment method | 6 | 6 | 100% |
| line count | 6 | 6 | 100% |

Status: 4 done, 2 needs_review, **0 false done** (gate holds).

| Receipt | Planted error | Status | Failed checks |
|---|---|---|---|
| mock-contant-afronding | – | done | – |
| mock-horeca-gemengd | total read `48,80` (truth `43,80`) | needs_review | `gross_sum` |
| mock-retour | – | done | – |
| mock-supermarkt-statiegeld-bonus | – | done | – |
| mock-weegschaal | – | done | – |
| mock-zonder-btw-id | 9% VAT row missing | needs_review | `vat_missing_rate` |

The 83% on gross and VAT per rate are the two planted receipts: the parser reports the misread gross (and the missing VAT row) as read, but refuses to call them `done`, which is what the gate wants.

### Gate stress test (MOCK)

For each of the 6 recorded answers every digit was deleted or replaced by each of the 9 other digits, in three sweeps (KIE corrupted with markdown intact; markdown corrupted with KIE intact; KIE corrupted with no markdown). No mutant reached `done` with a gross or per-rate VAT different from the truth (test `gate holds under single-digit OCR corruption`, 6 cases). Mutants that stay `done` are in fields the arithmetic cannot check (e.g. a digit in the date, KvK or bon number), so the gate says nothing about those fields; the date/time and merchant-key accuracy above is therefore only as good as the OCR.

## Open

- Real-corpus numbers (accuracy, per-rate vs per-line rounding, photo OCR quality) do not exist yet. Everything above is MOCK.
- `tools/qianfan/serve.md` and `colab_extract.ipynb` were not executed (no GPU/Colab here). Only their prompts and the fixed decoding flag are test-checked.
- Merchant, date and KvK/VAT ID digits are not covered by any arithmetic check; a single misread digit there still yields `done` (the VAT ID has a format check only, per v2 §5).


## Findings: integration tests, privacy canary, hardening

Scope: v2 §6, §8, §16.A hardening, §16.E, §16.F. Left to other agents: upload match → accept-match, lead threshold by KvK, deletion + retention job, export vs seed (they need the worker). Everything below ran against the docker-compose Postgres 16 (5433) and Mailpit; counts are copied from the output.

## Verification log

| Command | Result | Counts |
| --- | --- | --- |
| `pnpm --filter @lr/merchant-api test` | PASS | 9 files, 116 tests, 0 failed (lifecycle 55, idempotency 15, versions-batch 8, auth 14, freetext 18, logging 1, open-issues 2, privacy-canary 2, journey 1) |
| `pnpm --filter @lr/buyer-api test` | PASS | 9 files, 75 tests, 0 failed. Mine: resolve 18, claims 15, auth 13, threats 4, logging 1 (= 51); the other 24 belong to the buyer-REST agent |
| `pnpm --filter @lr/terminal-sdk test` | PASS | 8 files, 119 tests, 0 failed. Mine: store-contract 20 (Memory + SQLite), backoff 7, flusher 34, mapping 37, server 8, crash 4, demo 2 (= 112); `idb-store` 7 is the merchant-web agent's |
| `pnpm --filter @lr/db test` | PASS | 2 files, 70 tests, 0 failed (roles 66, migrate 4) |
| `pnpm --filter @lr/receipt-nl test` | PASS | 6 files, 173 tests, 0 failed. Mine: `lifecycle.test.ts` 62; the rest are the corpus agent's |
| `pnpm test:journey` | PASS | 6 hops, "Journey passed: 6 hops" |
| `pnpm test:privacy` | PASS | "0 hits in 35 needle×haystack searches; 6 controls ok" (7 needles × 5 haystacks: service logs, `pg_dump -n merchant`, `-n ops`, `-n pgboss`, merchant-side responses) |
| `pnpm lint` | PASS | `eslint .` printed nothing, exit 0 |
| `pnpm typecheck` | PASS | turbo: 23 successful, 23 total |
| Crash test stability: `cd packages/terminal-sdk && vitest run`, 3 runs in a row | PASS ×3 | 117 passed each (before demo.test.ts was added) |
| Mutation check on the canary: temporary `req.log.info(\`verify attempt for ${email}\`)` in `apps/buyer-api/src/routes/auth.ts`, then `pnpm test:privacy` | FAIL as intended | "2 leaks, 0 failed controls" (service logs: e-mail=1, e-mail local part=1), exit 1. File restored; `git diff` on it was empty afterwards |

### Failures observed before the fixes (so the fixes are evidenced, not assumed)

| Test (first run) | Observed | Fixed in |
| --- | --- | --- |
| `idempotency › concurrent v2 of one receipt` | a same-content replay under another key got `409 {"error":"version_gap","detail":{"expected":3}}` | ingest.ts: lock first |
| `auth › org B cannot overwrite or probe org A's receipt` | `expected 500 to be 409` | ingest.ts: 409 on persistent collision |
| all merchant-api files in parallel | `error: tuple concurrently updated` from `ALTER ROLE` in `migrate()` | migrate.ts: advisory lock |
| `resolve › the limit is per IP across both resolver routes` | six alternating requests all `200`; expected the 6th to be `429` | resolve.ts: shared limiter |
| `flusher › a whole batch answered 401 …`, `… 400 because ONE item is malformed …`, `… transient failure during the item-by-item fallback` | `rejected` 0, `retry: true` for ever (queue stays blocked) | sdk.ts: item-by-item fallback |
| `mapping.test.ts` | vitest hung (> 100 s) on `scrubDescription('x'.repeat(200))`; standalone: 36 `x` → 701 ms, ×3 per 2 extra characters | mapping.ts: regex rewrite |
| `pnpm --filter @lr/terminal-sdk demo` | `src/demo.ts` did not exist | added |

## Defects found and fixed

See `docs/decisions/integration.md` § "Fixes to production code" for the change and reason of each: (1) replay race → spurious `version_gap`; (2) cross-organisation receipt id → 500; (3) concurrent migrations race on roles; (4) resolver limit was per route; (5) refused batch retried for ever; (6) exponential regex in the PAN scrubber (till hang); (7) `sku`/`category` not scrubbed; (8) missing SDK demo.

Also found while testing and fixed in test support only: `scripts/lib/harness.ts` built the admin Drizzle handle without a schema (did not type-check against `Db`); it now passes `{ schema: tables }`.

## What is covered, by spec item

| v2 | Evidence |
| --- | --- |
| §6 every `(from, to)` pair, start states, `fiscalised` rejected for NL, void from anywhere, `presented → presented` | `merchant-api/test/lifecycle.test.ts` (HTTP, NL: 4 from-states × 5 targets + 5 start states; DE: 5 × 5 + start) and `receipt-nl/test/lifecycle.test.ts` (function). NL: any → `fiscalised` is `422 fiscalised_not_allowed_nl` (validation, before any DB access); other illegal pairs are `409 bad_transition`; illegal start at `void`/`fiscalised` is `422` (NL) / `409` (DE `fiscalised`) |
| §6 open receipts never visible to resolvers | `buyer-api/test/resolve.test.ts`: `pending` for right and wrong secret on both routes, no `resolve_failures` rows, not claimable (404) until the first `presented` version |
| §16.F idempotent replay, 409 conflict, same key / same `(receiptId, version)` different content, concurrent exactly-once | `idempotency.test.ts`: 201 then 200 `replayed`; 409 `idempotency_conflict` + one audit row (terminal, org, `{version}` only); 12 concurrent identical creates → one 201, eleven 200, one row; 6 concurrent different creates → one 201, five 409 |
| §16.F version gap then batch fill; batch per-item results; 500 limit | `versions-batch.test.ts`: `v3` before `v2` → `409 version_gap {expected: 2}`; `[v2,v3,v4]` batch lands in order; mixed batch returns created / replayed / 422 / gap / conflict / 401 per item; 500 accepted, 501 and 0 → 400 |
| §9 signatures, revoked, wrong terminal | `auth.test.ts`: bad per-version signature → 401 + `failed_signature` audit (receipt id, version, no content); bad/missing/foreign `X-Signature` → 401 + audit (`scope: request`); revoked → 401 on all five endpoints; wrong `X-Terminal-Id`/key → 401; org B: GET → 404, v2 append → 409 `version_gap`, same receipt id → 409 |
| §16.F resolve | `resolve.test.ts`: pending → ok flip; 404 on wrong secret; 400 on malformed; per-IP 5/min (dep) and **30/min at the real default (31st → 429)**; shared across both routes; `X-Forwarded-For` ignored; 10 wrong secrets/receipt/hour → 11th and the correct secret (both routes and `/v1/me/claims`) → 429 from any IP; lifts after 61 min; unknown ids never counted |
| §16.F claims | `claims.test.ts`: success (201, audit has receipt id only), second user 409 `already_claimed`, same user 200 `already_yours` (×3), expiry via `claimWindowDays` (3 days exact; 0 → 410) and via admin `claimable_until` in the past → 410, owner keeps a receipt after expiry, **race: 16 users in parallel → exactly one 201, fifteen 409, one `buyer.claims` row, one `claim` audit row**; 8 parallel claims by one user → one 201, seven 200 |
| §8 offline queue | `store-contract.test.ts` (one suite, `MemoryStore` and `SqliteStore`), `backoff.test.ts`, `flusher.test.ts`, `server.test.ts`, `crash.test.ts` (below) |
| §8 ordered flusher | 1 pending → `POST /v1/receipts` (or `/versions`); >1 → one `POST /v1/receipts:batch`; **1200 items → three requests of 500, 500, 200 in commit order**; `batchSize` clamped to 500; same bytes, signature and keys on retry; retryable: network, 5xx, 408, 429, `version_gap`; dead-letter + cascade to later versions of the same receipt (single and batch); 4 seeds × 40 receipts of random drops / 503s / lost acks → every `(id, version)` accepted once, per-receipt order intact, outbox empty |
| §8 backoff | `backoffMs`: 500·2ⁿ capped at 30 000 ms, scaled into [50 %, 100 %] by the random draw; spread (>40 distinct values in 50 draws); `startFlusher` with fake timers: gaps 250/500/1000 ms at random = 0, reset after recovery, `stopFlusher` stops |
| §2.2 / §16.E strip identifiers | `mapping.test.ts`: a POS sale with customer name/email/phone, loyalty-card number, `4111111111111111`, `****7391`, `4111 **** **** 1111`, cardholder, free note → the **signed CRF** (leaves and keys inspected, signature verified with the public key, CRF validates) contains none of them; claim secret absent, only its sha256 present |
| §16.E roles | `db/test/roles.test.ts` (66 tests): see "Privacy" below |
| §16.E canary | `scripts/privacy-canary.ts` (above) |
| §16.A | `merchant-api/test/journey.test.ts` runs all six hops inside vitest (~2 s) |
| §16.F crash test | `terminal-sdk/test/crash.test.ts`: four scenarios (decisions doc). In the first, the dead client still has queued items that the server already stored (asserted `> 0`, observed after killing at the arrival of batch 2: the server held 40 versions while the outbox had only had batch 1's 20 removed); after the restart every version is stored once, in order, outbox `{pending: 0, rejected: 0}` |

### Privacy (§16.E) in detail

- `merchant_api` and `dashboard`: SELECT, INSERT, UPDATE, DELETE and TRUNCATE on each of the 9 tables in `buyer` and `leads` → `42501 permission denied` (108 statements: 9 tables × 6 kinds × 2 roles); they have no USAGE on either schema. Positive control: `buyer_api` reads all 9, each holding a seeded row. A guard test lists the tables so a new table cannot silently escape the loop.
- RLS (merchant_api: 6 tables, dashboard: 10 tables): own org visible, other org not (also by key probe), no org / unknown org / empty string → 0 rows, malformed org id → `22P02` error (fails closed), INSERT for another org → `row-level security policy` error (receipts, versions, lines, locations, merchant_users, exports), moving a row into another org via UPDATE → same error, UPDATE/DELETE aimed at another org → 0 rows and the data is intact.
- `buyer_api` and `worker`: no privilege at all on `terminals`, `merchant_users`, `dashboard_sessions` (so `api_key_hash`, `signing_public_key`, `password_hash`, `totp_secret_encrypted`, `token_hash` are unreachable); `organizations`/`locations` readable only through the whitelisted columns (`plan`, `created_at`, `lat`, `lng`, `timezone` denied); none of them can call the three `SECURITY DEFINER` lookups; `merchant_api` cannot call the dashboard ones and `dashboard` cannot call `authenticate_terminal`. `buyer_api` is read-only on merchant receipts tables.
- `ops.audit_log` is INSERT-only for all four roles (SELECT/UPDATE/DELETE/TRUNCATE denied); `buyer.consents` is INSERT/SELECT only; nobody can create objects in `public`, `merchant` or a new schema.
- Structural: no merchant column can hold a buyer identifier (the only columns matching `email|phone|user|buyer|customer|loyalty|pan|card|person` are `merchant_users.email` and `dashboard_sessions.user_id`), and no foreign key crosses from `merchant` into `buyer`, `leads` or `ops`.
- Roles end with LOGIN, no superuser, no BYPASSRLS, no CREATEDB/CREATEROLE; RLS is enabled on every `merchant` table.

## Threat list rows I can evidence (v2 §15)

| Threat | Covered by | What actually happens |
| --- | --- | --- |
| Shoulder-surfed or photographed QR at the till | `buyer-api/test/threats.test.ts › before anyone claims, the first holder … wins` | The secret *is* the capability: whoever claims first owns the receipt (201); the real customer then gets `409 already_claimed`. Mitigations that exist: 256-bit secret, the 10-failures/hour limit (does not help here: the secret is correct), `claimable_until`. **No second factor exists**; accepted risk, recorded |
| Shared or forwarded receipt link | `threats.test.ts › someone else holding the link …`; `resolve.test.ts › exposes nothing buyer-side` | After the owner claims, a second user gets `409` and the receipt does not enter their wallet (`/v1/me/receipts/:id` → 404). **But `/v1/resolve/view` keeps returning the full receipt (lines, totals, versions) to anyone holding the link, forever** (with `claimed: true`); the response carries no user id or e-mail. Behaviour is as v1 specified for the resolver; whether the read-only view should stop after a claim is a product decision. Open |
| Secret left in browser history / share sheet | not covered here (wallet E2E) | Server side only: the secret never appears in a URL path or query, only in POST bodies and the URL fragment; logs verified secret-free (`apps/*/test/logging.test.ts`) and canary shows it nowhere on the merchant side |
| Claim race | `claims.test.ts › claim race` | 16 parallel claimers: one 201, fifteen 409 `already_claimed`, exactly one row (`buyer.claims.receipt_id` is the primary key), one `claim` audit entry. Same user from 8 devices: one 201, seven 200 |
| Terminal clock backdating | `threats.test.ts › the claim window runs from the server received_at …` | `claimable_until = received_at + CLAIM_WINDOW_DAYS` using the **server** clock for terminal receipts dated 2020-01-01, 2099-01-01 and now alike (90 days to 6 decimals). A 2020-dated receipt is claimable today. **`createdAt` is stored exactly as sent**: no check against the server clock, no skew bound, so a terminal (or one with a wrong clock) decides the date the buyer sees, how the receipt sorts in the wallet and which `from`/`to` filter it matches (tested). Whether the dashboard archive, reports and VAT export bucket by this terminal date was not tested here. Open: v2 left the choice undecided; a bound such as ±24 h would be a product decision |
| Versions signed offline before a key was revoked | `terminal-sdk/test/server.test.ts › threat: …` | Revocation is checked at upload time, not signing time. A revoked terminal's queued versions get **`401 unauthorized`**: single upload path → item dead-lettered; batch path → (after fix 5) the 401 batch is retried item by item and all are dead-lettered; before the fix the queue retried for ever. Versions the server accepted *before* the revoke stay (not retroactive). A claimed receipt whose later versions were refused stays at its last version: the buyer sees the presented pre-bill, `final: false`. A replacement terminal cannot continue it (`404`: appends must come from the receipt's own terminal). The refused attempts leave **no audit entry** (revocation fails before signature checking) |
| Free text that could carry identifiers | `merchant-api/test/freetext.test.ts`; `terminal-sdk/test/mapping.test.ts` | Server: every unknown key (`notes`, `customerName`, `loyaltyCard`, `pan`, `email`, `phone`, … at top level and nested) → 400, nothing stored; description > 80 characters → 400; `fiscal.extra` ≤ 10 keys × 80 characters. **Residual channels the server does not inspect and tests pin as stored-as-sent:** `lines[].description`, `sku`, `category`, `fiscal.extra` values, `documentNumber`, `merchant.name`. The SDK scrubs masked PANs and ≥ 8-digit runs from descriptions, masked PANs from `sku`/`category`; a **name typed into the description cannot be detected** (`Taart voor Jan Jansen` is kept) and a 6-digit BIN prefix of a partly masked PAN survives |

## Open

1. The three v2 Handoff issues are unchanged and pinned by `merchant-api/test/open-issues.test.ts`: (1) `claimSecretHash` is outside the per-version signature (a signed v1 is accepted with any hash); (2) payload `terminalId`/`locationId` are not compared with the authenticated terminal (the columns come from the authentication); (3) claim window uses server `received_at` (evidenced above). If v2 changes, flip those tests.
2. `/v1/resolve/view` stays readable after the receipt is claimed (threat "forwarded link").
3. No bound on terminal-supplied `createdAt` (threat "clock backdating").
4. Revoked-terminal requests are not audit-logged (only `failed_signature` after authentication is). A burst of attempts with a stolen revoked key is invisible in `ops`.
5. The SDK keeps dead-lettered items (`rejected` table) but offers no replay or export, so after a key rotation mistake the signed versions are stranded on the terminal.
6. Buyer `/v1/me/*` authenticates in a `preHandler`, i.e. after body validation: an unauthenticated malformed request gets `400` instead of `401` (pinned in `buyer-api/test/auth.test.ts`). The same pattern is in `consents.ts` and `uploads.ts`. Low impact; not changed because those files belong to another agent.
7. RLS trusts `app.org_id`, which the connection can set itself (tested): it protects against application bugs, not against a compromised merchant-api or dashboard process. `buyer_api` and `worker` can read `receipts.claim_secret_hash` (needed to verify secrets; a hash of a 256-bit value).
8. Per-IP rate limit state is in process memory (as decided); a second instance would double the allowance. The failed-secret counter is in Postgres and holds across instances, but `ops.resolve_failures` rows are never deleted by anything yet (the retention job is another agent's).
9. Email login: 5 codes per address per hour means anyone can lock a victim out of requesting codes for an hour (DoS, by design of the limit).
10. Not covered here because they need the worker or uploads: upload match → accept-match, lead threshold keyed by KvK, deletion + retention (claims gone, receipts remain), export vs seed.
11. Batch fallback after a refused batch sends up to 500 single requests; acceptable for a rare failure, not optimised.
12. `documentNumber` is passed through unscrubbed by the SDK (limit 60 characters on the server).


## Findings: worker, buyer-api uploads/insights/consents/push/export/pdf/account, seed, leads report

All commands run from the repo root against the docker-compose Postgres (5433), Mailpit and the S3 mock (`adobe/s3mock`). Counts are copied from the output. Numbers computed from the corpus are **MOCK**: the corpus used was the mock one (6 receipts).

## Verification log

| Command | Result | Counts |
|---|---|---|
| `pnpm --filter @lr/worker test` | PASS | 8 files, 56 tests (extract-upload 10, notify-version 8, seed-export-rollup 6, leads 6, extractor 5, categorise 15, retention 3, worker-loop 3) |
| `pnpm --filter @lr/buyer-api test` | PASS | 7 files, 61 tests (mine: consents-push 9, account-export-pdf 4, insights 3, uploads-api 8; the other 3 files are IntegrationTests') |
| `pnpm --filter @lr/worker typecheck` | PASS | exit 0 |
| `pnpm --filter @lr/buyer-api typecheck` | PASS | exit 0 |
| `pnpm --filter @lr/storage typecheck` / `@lr/db` / `@lr/schema` / `@lr/dashboard-core` / `@lr/receipt-nl` | PASS | exit 0 each |
| `pnpm lint` | PASS | no output after `eslint .` |
| `pnpm test:journey` | PASS | 6 hops, "Journey passed" |
| `pnpm db:migrate` (dev DB; applies 0003, 0004) | PASS | "migrated receipts" |
| `pnpm db:seed` (dev DB, first run) | PASS | 200 receipts (+1 official), 30 claims, 3 uploads, 2 terminals, owner + buyer |
| `pnpm db:seed` (twice more) | PASS | "0 receipts, 0 claims, 0 uploads, 0 terminals created" both times |
| `PG_DATABASE=seedcheck pnpm db:migrate && pnpm db:seed` ×2 on a fresh database, then `drop database` | PASS | first run 201 receipts, 30 claims, 3 uploads, 2 terminals; second run created 0; query counts afterwards: receipts 201, versions 239, claims 30, uploads 3, rollups 59, uncategorised lines 0, leads 2 |
| `pnpm leads:report` | PASS | after the smoke uploads: 3 merchants, status collecting 3, 4 pairs, histogram `1-4: 3` |
| Smoke: `node apps/buyer-api/src/main.ts` (port 4012) + `node apps/worker/src/main.ts` against the dev DB, real Mailpit login, real S3 PUT of `mock-supermarkt-statiegeld-bonus.png` and `mock-horeca-gemengd.png` | PASS | first: `complete` 202 → `done`, gross 1973, "Supermarkt De Hoek"; second: → `needs_review`, failures `["gross_sum"]` (the planted digit error). Worker log lines show `extract_done` with ids and counts only. |

### What the tests prove (all against real Postgres + S3 + Mailpit where relevant)

- **Upload → done** (presign, real PUT to S3, `complete`, `extract-upload`, status endpoint with draft); **needs_review → PATCH → done**; another user gets 404 on read/complete/patch; `complete` before the PUT is 409; a file over 10 MB is deleted and the upload fails `bad_size`; unknown media/oversize requests are 400; no recording → `failed: no_recorded_extraction`; transient error rethrown, final attempt → `failed: extractor_unavailable`.
- **Match → accept-match**: same KvK/VAT ID, same gross, within ±30 min, unclaimed → `matched_receipt_id`; accept-match creates a `photo_match` claim, the upload becomes `replaced`, accepting again is idempotent. No match for wrong gross (±1 cent), 31 minutes either side, `open` receipts, or a receipt someone else claimed (409 on accept). A total corrected by the buyer can create the match.
- **Leads**: keyed by `kvk:` when the VAT ID is missing, `vat:` otherwise; the same user twice counts once; the second distinct user reaches `LEAD_THRESHOLD=2` → `new`; a known organisation (by VAT ID, or by KvK only) is never a lead; 6 concurrent uploaders are all counted; `leads:report` prints no names, keys, postcodes or user ids.
- **Retention**: deleting an account → 204, all sessions and subscriptions gone at once, sign-in refused, audit entry without the user id; day 29 nothing hard-deleted; day 31 user, claims, uploads, consents, email codes, the S3 object and lead-uploader rows are gone and the lead count recomputed, **merchant receipts and their versions remain**, other users untouched. Receipts past `retention_years` (1 vs 7) are deleted with versions, lines, claims and idempotency keys; newer ones stay. Expired codes/sessions, old `resolve_failures` and abandoned uploads are pruned, fresh rows stay.
- **Export matches the seed, recomputed independently**: the test runs the real seed on a fresh database, then computes VAT per Amsterdam day and rate from the seed plan with its own arithmetic (no `@lr` code; round-half-up per receipt and rate) and compares it to the `btw_csv` the `export` job uploaded to S3 and the test fetched through the 24 h link: every day row (rubriek 1a/1b, gross/net/vat/receipts) and the period totals agree to the cent; void and presented receipts are absent. The `sales_csv` has one row per paid/void receipt and its gross and rounding totals match. `daily_rollups` equal the oracle per day (gross, VAT per rate, paid count, void count) and re-running replaces rows.
- **notify-version**: exactly one request per version per subscription to a local HTTP push endpoint; headers `content-encoding: aes128gcm`, `authorization: vapid t=…, k=<public key>`, `ttl`, a per-version `topic`; the body has no readable receipt text and **decrypts with the browser-side private key** (RFC 8291 implemented in the test) to `{title, body, receiptId, version, final}`; v2 says "nog niet definitief" (`final:false`), v3 `paid` says definitief (`final:true`); void says vervallen. 410 and 404 delete only that subscription; 503 keeps it and fails the job; only the owner's subscriptions are used; no claim → nothing; no VAPID → skipped; logs contain no endpoint, key or text. The pg-boss loop test shows a job sent by `merchant_api` is delivered as one push.
- **Categoriser**: 12 keyword cases, apotheek vs drogist rules, table consistency; the job fills null categories, keeps the terminal's, flags health lines, and a second run changes 0 lines.
- **Extractor**: HTTP extractor against a stub OpenAI-compatible server sends both fixed prompts with `temperature 0` and a base64 data URL, takes the revision from the response; 4xx permanent, 5xx retryable, PDF and unknown bytes refused with a code; recorded extractor reads `<sha>.qianfan.json` and falls back to `mock/`.
- **Buyer REST**: consents (defaults off, append-only with policy version, change-only rows, the DB role cannot UPDATE/DELETE), push subscriptions (create/upsert/move/delete/limits/endpoint rules incl. production mode), insights (hand-computed months, categories, top merchants; pre-bill, void, other users excluded; health line shown as `overig`; upload counted), export (no other user's data, no keys/hashes/secrets), PDF (`%PDF-`…`%%EOF`, 404 for others), delete account, upload guards (503 without storage, 429 at 50/hour, strict bodies), body-less JSON POST.

## Open

- **PDF uploads are accepted but not extracted by the `http` extractor.** vLLM's chat endpoint takes images; rasterising PDF pages is not implemented, so the upload fails with `pdf_unsupported`. (`recorded` works for any file with a recording.) The same applies to `image/heic` (`unsupported_file`); iOS normally converts to JPEG for a file input.
- **The `http` extractor was only exercised against a stub server**, not a real `baidu/Qianfan-OCR` endpoint (none was available). Real accuracy on real receipts is still unmeasured (see corpus findings).
- **Real push delivery is unverified**: pushes were received by a local HTTP endpoint and decrypted with the right key, not by FCM/APNs/Mozilla. Behaviour of real push services (e.g. their handling of the `Topic` header) is untested.
- **Browser PUT to S3 is untested** and the bucket needs a CORS rule for `RECEIPT_HOST`; the S3 mock does not enforce the signed `Content-Length`, so the real-S3 size enforcement is only covered by the `complete` size check.
- Export files stay in S3 after the 24 h link expires (needs a lifecycle rule, a deployment decision). Daily rollups are kept after their receipts are deleted by retention.
- **Accept-match is a claim without the secret.** An attacker who photographs (or fabricates) a receipt of a merchant whose KvK/VAT ID they know, with the right total and time, can claim an unclaimed official receipt. It is the design in v2 §11; the exposure is limited to receipts that are unclaimed, in the 30-minute window and have exactly that total. Not covered by a test of abuse; a candidate for the threat list.
- No per-process upload throttle on the presign endpoint beyond the 50/hour database count; `@fastify/rate-limit` is per process (as documented for the buyer API).
- The three "Known open issues" in v2 are untouched.


## Wallet findings (`apps/wallet`)

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

1. Logged out, open `/r/<id>#<secret>` → `presented-banner` reads "Not a final receipt — this is the bill, the final receipt follows after payment", 2 `receipt-line`s, `save-to-wallet`, **no** `confirm-sheet`. `location.hash` is `''` and `page.url()` has no `#`. No captured request URL contains the secret.
2. Save → `/login?next=/r/<id>` → email code read from Mailpit → back on `/r/<id>` with the "Save this receipt?" sheet showing Café Het Plein, € 10.69, time.
3. Save → `/receipts/<id>?saved=1`, banner + 2 VAT rows. Wallet `/` lists 1 `receipt-item`.
4. (prod) service worker controls the page; context offline → `/receipts/<id>` renders from the service-worker shell + IndexedDB (`cached-notice`, `offline-badge`, 2 lines).
5. (prod) offline, open a second receipt link → `arriving-state` (fragment stripped); `/` shows 1 `arriving-item`. Back online (`setOffline(false)` + `online` event) → the pending claim completes, no arriving items, wallet has 2 receipts.
6. (prod) SDK pays v3 cash → `/receipts/<id>` shows `final-badge`, no banner, rounding line, version history.
7. (prod) CDP `ServiceWorker.deliverPushMessage` with the worker's payload shape → the SW shows exactly one notification with title/body/tag=receiptId/data.
8. Add-receipt UI: file chosen → presign → PUT → complete → poll → `needs_review` correction form pre-filled (merchant, `19,99`) → PATCH → `match-offer` "Official receipt found — replace?" → `accept-match` → `/receipts/<id>`. **The upload endpoints were mocked with Playwright `page.route`** (the throwaway stack has no S3 or worker); this checks the UI, not buyer-api/S3/worker.
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


## Findings: merchant-web, dashboard-core, browser terminal

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
login → TOTP enrol (otpauth URI + secret shown, code from `otpauth`) → archive; terminals page: generate keypair, create terminal, API key shown (43 chars), gone after dismiss and after reload, revoke (two-step) → status `revoked`; simulator: "Set up demo terminal" → 2×koffie + bier → Present → QR rendered at 576×576 px (1280×900 window) with the URL as text → Pay cash (rounding €0,01, total €10,70) → outbox drains to 0; Offline toggle on → 3 card sales queued → off → outbox drains; archive shows 4 receipts, the oldest has 2 versions, PDF download is `application/pdf` starting `%PDF-`; reports show the day row (4 receipts, €25,54 gross, €21,72 net, €3,82 VAT, rounding €0,01); an export request is `queued`; users, organisation (KvK shown) and locations pages load; logout. Console errors: none. Server side of the same run: 4 receipts (v2 + three v1), audit rows `terminal_key_created` ×2 and `terminal_key_revoked` ×1.

### What the automated tests cover

- **Auth:** wrong password and unknown email both fail; TOTP enrol (wrong first code does not enrol; seed stored encrypted `v1.…`, never plaintext); verify path on the next login; password-only session is not an actor; pre-MFA expiry at 10 min, full session 12 h (injected clock); token stored as sha256; logout; enrolment token bound to its session; 5 wrong codes delete the session and write `dashboard_mfa_failed` without the email; sessions resolve only to their own org; KeyProvider round trip, wrong-length key rejected, tampered ciphertext rejected.
- **Roles:** the permission table; accountant gets reads + export request and `ForbiddenError` from every write/user/terminal function; manager can run locations but not org settings or users; last owner cannot be demoted/deleted; cross-org user ids are `not_found`. Same matrix checked again over HTTP (accountant 403s).
- **Terminals:** key returned once, only `sha256` stored (checked in the DB row and in the list output), public key validated (6 bad shapes), other org's location refused, revoke sets `revoked_at` (seen through merchant-api's `authenticate_terminal`), both audit events present without the key, and a revoked key makes merchant-api answer 401 to the browser-path SDK (dead-lettered, not retried).
- **Reports:** seven sales built with the real terminal SDK and hand-computed expected values (daily and monthly rows, VAT per rate with per-receipt rounding, cash rounding +1, a void, a presented-only bill excluded, an Amsterdam midnight boundary: 23:30 UTC on 31 March counts on 1 April); other org's sale never appears; `vatByDay` agrees.
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


## Findings: browser E2E (Playwright) and the real `pnpm dev` stack

All numbers are copied from output I saw. Machine: macOS arm64, Docker compose (Postgres 5433, Mailpit, S3 mock) running, database `receipts` as the orchestrator left it (I did **not** run `docker compose down -v`, `db:migrate` or `db:seed` myself; the suite does not depend on seed data, it creates its own organisations).

## Verification log

| Command | Result | Counts / observation |
|---|---|---|
| `pnpm test:e2e` ×3 consecutive, each **cold** (nothing listening; global setup started `pnpm dev`, waited for readiness, stopped it afterwards; ports free again after each) | PASS ×3 | each: **4 passed, 0 failed, 0 flaky**; durations 28.0 s, 27.6 s, 27.4 s (including stack start-up and warm-up; wall 28.5 s / 28.1 s / 28.0 s); per test ≈ journey 12.8 s, buyer-offline 1.2–1.3 s, dashboard 2.1 s, merchant-offline 3.0 s |
| `pnpm test:e2e` once more after the last edit to `e2e/support/dashboard.ts` (cold) | PASS | 4 passed (27.0 s) |
| `pnpm test:e2e` against a stack I started with `pnpm dev` (reuse mode), 5 runs on the same server | 4 PASS, 1 FAIL | PASS: 4 passed (20.1 s), (20.8 s), (21.4 s), (20.8 s). **FAIL (flake, cause below):** run 3 of that series: 2 failed (`dashboard`, `merchant-offline`), 2 passed, 2.6 min |
| `pnpm lint` | PASS | exit 0, no output (with `docs/e2e-report` present, after adding it to the eslint ignores) |
| `pnpm typecheck` | PASS | turbo: 24 successful, 24 total (includes the new `@lr/e2e`) |
| `pnpm --filter @lr/worker test` | PASS | 8 files, 56 tests (after the `resolveVapid` change) |
| `pnpm --filter @lr/buyer-api test` | PASS | 9 files, 75 tests |
| `pnpm e2e:report` | PASS | `docs/e2e-report` 6.8 MB (index.html, `data/`, `trace/`); `docs/e2e-screenshots` 7 PNGs, 776 KB |
| Real `pnpm dev` (`turbo run dev --parallel`) started in the background, then `curl` | PASS | `merchant-api :4001/healthz` 200 · `buyer-api :4002/healthz` 200 · `merchant-web :3000/dashboard/login` 200 · `wallet :3001/` 200, `/sw.js` 200 `text/javascript`, `/manifest.webmanifest` 200 `application/manifest+json` · `GET :4002/v1/push/vapid-public-key` 200 with the dev public key · worker log line `{"event":"worker_started","extractor":"recorded","vapid":true}` · DB connections as `merchant_api`, `buyer_api`, `worker` seen in `pg_stat_activity`. Stack was ready ≈ 10–13 s after start (wallet build 4.9–5.4 s included). turbo prints "`--parallel` is deprecated" (warning only). The same readiness probes pass in the three cold `pnpm test:e2e` runs above, where global setup waited for all five services. |
| Login limiter probe: 22 × `POST /api/dashboard/totp/begin` without a session on a fresh stack | as designed | 20 × `401`, then `429`, `429` |

## What each scenario proves (all PASS in the runs above)

1. **Buyer journey on a phone** (`buyer-journey.spec.ts`): owner created in the DB, dashboard login with TOTP enrolment, demo terminal set up in the simulator, 2×Koffie + Bier presented (€10.69), QR URL read from `sim-qr-url`; a second context with the `iPhone 13` descriptor opens it: `presented-banner` "Not a final receipt", 2 lines, no confirm sheet while logged out, `location.hash === ''` and no `#` in the URL; Save → login → code from Mailpit → `confirm-sheet` (merchant name, `10,69`) → save → `/receipts/<id>` (no fragment) → wallet list shows the receipt (`data-state=presented`). A push subscription with real generated keys is registered; the simulator pays (card): the server holds v2 `paid`; the wallet after reload shows `final-badge`, `data-state=paid`, `data-version=2`, no banner. The local push endpoint received **exactly 1** request (re-checked after a 6 s quiet window), `Content-Encoding: aes128gcm`, no merchant name / amount / receipt id in the ciphertext, and RFC 8291 decryption yields `{receiptId, version: 2, final: true}` with exactly the keys `title, body, receiptId, version, final`.
2. **Buyer offline** (`buyer-offline.spec.ts`): receipt 1 saved online (SDK till → merchant-api); service worker controls the page; `setOffline(true)`; opening receipt 2's link shows `arriving-state` with the fragment stripped; `/` shows the offline badge, 1 `arriving-item` (id of receipt 2) and the saved receipt; the saved receipt renders from cache (`cached-notice`, 1 line, merchant name); `setOffline(false)` **without reload** → 0 arriving items, 2 receipts in the list, offline badge gone.
3. **Merchant offline** (`merchant-offline.spec.ts`): Offline toggle, 3 card sales (koffie, appeltaart, bier), `sim-pending` = 3, the dashboard archive (second tab) is empty; toggle off → outbox drains (0 pending, 0 rejected) → archive shows exactly 3 rows, all `paid`.
4. **Dashboard** (`dashboard.spec.ts`): TOTP enrolment then logout and login with a freshly computed code; terminal created; key (43 chars) shown once, works against merchant-api (200); gone from the DOM after dismiss and after reload, never in the list API; two-step revoke → status `revoked` → merchant-api answers **401** for that key.

Screenshots (overwritten each run): `docs/e2e-screenshots/{qr-on-simulator,receipt-on-phone,save-receipt-sheet,wallet-with-receipt,voided-receipt,arriving-state,dashboard-archive}.png`. Report: `playwright-report/` (git-ignored) copied to `docs/e2e-report/` by `pnpm e2e:report`.

## Flake and development failures (all understood)

- **Flake, 1 occurrence: dashboard login limiter (429).** In the 5-run reuse series, run 3 failed `dashboard` (element not found) and `merchant-offline` (timeout at `totp-secret`). Cause: merchant-web's in-memory limiter (20 `totp` requests per IP per 5 min); one suite run makes 7, and the same dev server had already served 16 in the window (a journey-only debug run, one full run and run 1), so the 21st request got 429. I did not capture the failing run's artifacts (the next run cleared `test-results/`); the cause is inferred from the request counts and **confirmed by reproducing the limiter** (probe above: 20 × 401 then 429). Not seen in any cold run (a stack restart resets the window) or in runs that stayed under 20 per window. After this I changed `loginDashboard` to fail immediately with the page's error text ("too many attempts") instead of waiting for a timeout. **Practical rule:** at most two suite runs per five minutes against one running dev stack, or restart it.
- During development (before the passing runs) the suite failed three times for test-side reasons, each fixed in the test, none by weakening an assertion: (a) `/dashboard` redirects to `/dashboard/archive` (I asserted `/dashboard`); (b) merchant-api's `GET /v1/terminals/me` requires `X-Terminal-Id` besides the Bearer key (my 401 was "missing header", not "bad key": both calls now send it, so the later 401 can only mean *revoked*); (c) `sim-pending` is polled every 400 ms and read 0 before the flush began, so the wallet was reloaded before v2 reached the server (now `expectServerHas`), and the offline test had never loaded the wallet list online, so there was no cached list (now it does, as a real user would). No app defect was involved.

## Open / not verified

- **Not covered by Playwright here:** real phone camera QR scan; real push delivery to a device (the worker's request is received and decrypted by a local endpoint; push services such as FCM/APNs are not involved); iOS/Safari/WebKit (the `iPhone 13` descriptor runs on Chromium; no WebKit browser is installed); `notificationclick`; PWA install; the wallet upload/photo, insights and settings UIs; accountant/manager views of the dashboard.
- **`scripts/journey.ts` hop 6 is unchanged** (still `@lr/dashboard-core` against the throwaway DB, not the dashboard over HTTP): doing it over HTTP needs a Nuxt server on the throwaway database inside a script wrapped by vitest tests; see `docs/decisions/e2e.md`.
- **Dev database accumulates test data:** each run adds 4 organisations "E2E Café …" (with owner, location, terminals, receipts) and ~6 e-mails to Mailpit. Harmless for dev; removed by `docker compose down -v`.
- The suite is sequential (`workers: 1`) by choice: one stack, one login limiter, and Nuxt dev compilation; total ≈ 20–28 s.
- Reuse mode takes whatever database the running stack uses; setting `PG_DATABASE` for the suite only affects a stack that global setup starts itself (see decisions).
- The wallet's `dev` script now builds and serves the production build (see decisions: the service worker needed for the offline scenario exists only in a build); HMR is `pnpm --filter @lr/wallet dev:hmr`.

## Qianfan path: verification log

Run on the mock corpus (MOCK numbers).

- `pnpm --filter @lr/worker test`: PASS, 8 files, 60 tests (new: URL handling, 408/429 transient, 400 permanent, revision source, auth header).
- `pnpm --filter @lr/receipt-nl test`: PASS, 7 files, 177 tests (new `corpus-selection.test.ts`: temp real-style dir, 1 real receipt id `real-0001` derived from mock-weegschaal; real preferred by `loadCorpus`, `only:'mock'` ignores it, seed falls back to mock with <3 real, uses real at 3, eval runs on real).
- `pnpm eval:extraction`: PASS, "GATE OK: zero false done (6 receipts evaluated)", MOCK corpus.
- `pnpm db:seed`: PASS (DB already seeded, 0 created, so the corpus line is not printed; fallback covered by the corpus-selection test).
- `pnpm lint`, `pnpm typecheck`, `pnpm test:privacy` (0 hits in 35 searches): PASS.
- Notebook `tools/qianfan/colab_serve.ipynb` parses as JSON (python json.load). Not executed (no GPU/Colab here).

## Manual check with a real file present
Temporarily copied mock-weegschaal's png/truth (id `real-tmp-1`, `mock` flag dropped) and its `<sha>.qianfan.json` into fixtures/receipts-nl/:
- `pnpm test`: PASS across all packages (worker 60/60 unchanged; receipt-nl 172 tests as corpus tests then run on the 1 real receipt).
- `pnpm eval:extraction`: "Corpus: REAL (1 receipts ...)", GATE OK, 1 receipt evaluated.
- `pnpm db:seed`: ran, already seeded so no upload step. Files then removed; `git status fixtures` clean.
To repeat: drop 1 real truth+image+recording, run the three commands; remove them. Seed fallback on a fresh DB prints `Seed corpus: MOCK (... ; real corpus has 1 usable receipts, need 3)`.

## Findings: photo receipts end to end (steps 3 to 6, PhotoFeature part)

All numbers below were observed on this machine (Docker: Postgres 5433, s3mock 9090, Mailpit 8025). Everything uses the **MOCK** corpus (`fixtures/receipts-nl/mock/`) and `EXTRACTOR=recorded`.

## Verification log

| Command | Result |
| --- | --- |
| Chromium probe: presigned PUT of a mock PNG from `http://localhost:3001` (plain Node server) to s3mock `http://127.0.0.1:9090` | **PASS**: status 200, `HEAD` size 84194 = file size. (First attempt from a `page.route`-fulfilled page: blocked with "loopback address space" permission: probe artefact, see decisions.) Probe script was throwaway and removed; the e2e spec keeps the check. |
| `pnpm lint && pnpm typecheck && pnpm test && pnpm build` | **PASS** (exit 0). typecheck 25/25 tasks, build 13/13. Tests: config 7, storage 1, compliance 8, crypto 17, schema 2, receipt-nl 209, wallet 85, terminal-sdk 119, merchant-api 116, worker 68 (9 files), buyer-api 83 (9 files), db 72, dashboard-core 37, merchant-web 13. |
| `pnpm test:journey` | **PASS**: 6 hops |
| `pnpm test:privacy` | **PASS**: 0 hits in 35 needle×haystack searches; 6 controls ok |
| `pnpm eval:extraction` | **PASS** (gate): MOCK corpus, 6 receipts, 4 done, 2 needs_review, 0 false done (unchanged by this work) |
| `pnpm test:e2e` (nothing listening on 3000/3001/4001/4002; the suite started its own stack) | **PASS** twice on the final code: 9 passed (1.1 min each). Of those 4 are `e2e/photo-upload.spec.ts` (full flow, PDF/HEIC refusal, unreadable photo with reason, needs-review correction with category). An earlier run with 8 tests (before the 4th was added) also passed twice. |

New tests (counts are of the tests added, all passing): `packages/receipt-nl/test/merchant-rules.test.ts` 32 (merchant rules, normalisation, "Albert Heijn" vs "AH", precedence, `categoriseLines`, user-edit precedence); `apps/worker/test/photo-categories.test.ts` 8 (extraction stores categories, PATCH re-categorises, user category kept after PATCH and never sensitive, insights follow edits + VAT per rate, list category filter, DELETE row + S3 object, DELETE of someone else's upload is 404, PDF/HEIC refused); `apps/buyer-api/test/uploads-api.test.ts` +7 (PDF/HEIC refused with no row, DELETE guards and 503, photo endpoint, category endpoint, category filter); `apps/buyer-api/test/insights.test.ts` +1 and the existing expectations extended with `vatPerRate`; `apps/wallet/test/api.test.ts` +2 (PDF/HEIC never presigned, new API calls); `packages/storage/test/presign.test.ts` 1.

## Changed existing tests (spec change, not weakened)

- `apps/buyer-api/test/uploads-api.test.ts`: a `application/pdf` upload request used to be 201; now PDF and HEIC are 400 (plus webp/jpeg are 201).
- `apps/wallet/test/api.test.ts`: `validateUploadFile` used to accept PDF; now refuses it.
- `apps/buyer-api/test/insights.test.ts`: the upload fixture line now carries the stored `category`/`sensitive` (what the worker writes now); insights no longer categorise at read time.

## Open / not verified

- **Hosted storage**: browser PUT against Supabase Storage's S3 API or a boxd-hosted s3mock was not tested (CORS for the wallet origin; the presigned host must be browser-reachable over HTTPS). The SDK checksum fix matters there. Fallback (upload through buyer-api) is described in `docs/decisions/photo-feature.md`, not built.
- **Phone / Safari / HEIC**: no real phone camera test. HEIC is refused in the wallet; iOS usually converts to JPEG when `accept` lists only JPEG/PNG/WebP, not verified.
- `pnpm --filter @lr/wallet smoke` (not part of the checks) fails at its first step (`presented-banner` never appears: the demo no longer has pre-bills). It stops before reaching the upload part. Not looked into; I did not run it on `main`.
- Legacy upload rows without stored categories count as `overig` in insights (no migration backfills them). Only affects uploads created before this change.
- The worker package is shared with the QianfanPath work; the numbers above were taken before its changes landed in `apps/worker/src/extractor*.ts`/`env.ts` (not present in the working tree at the time). Re-run `pnpm --filter @lr/worker test` after merging.
- The wallet `docs/e2e-screenshots/` set was not refreshed: only `photo-upload-detail.png` and `photo-insights.png` are new (the run also rewrote the old screenshots; those were reverted).

## Live Qianfan check (Colab T4, vLLM 0.31.0, revision `623bf5d2`)

Run on 2026-10-17 through a Cloudflare quick tunnel with an API key. Commands and observations only; nothing here is a measured accuracy figure.

| Check | Result |
| --- | --- |
| Endpoint without key / with key | 401 / `/v1/models` lists `baidu/Qianfan-OCR` (`max_model_len` 8192) |
| Worker `httpExtractor` + `parseExtraction` on 2 **MOCK** images | both `done`; gross, per-rate VAT and shop identity equal the truth files (supermarkt 1973 = 1973, VAT 9% 68 / 21% 190; horeca 4380 = 4380, VAT 9% 150 / 21% 444); 51 s and 57 s per image (two requests each) |
| Full stack (`EXTRACTOR=http`): wallet `/add` upload of a MOCK image | `done` after 51 s; 8 lines with category and VAT rate |
| **Real photo**: a PLUS supermarket receipt, 1512 x 1512 JPEG, receipt a thin strip in the middle of the frame (`receipt.jpeg`, not committed) | **Uncropped: no result.** The model request ran longer than the worker's 120 s timeout and than Cloudflare's roughly 100 s limit (a direct request returned an HTML error page after 126 s), so the upload stayed `processing` through all retries (4 min 39 s when checked). **Cropped to the receipt (430 x 1512): read in 46 s** (715 output tokens) |
| Same cropped photo through the wallet | `needs_review` after 87 s, which is the right outcome (see below) |

What the cropped real receipt gave:
- The markdown read the shop (PLUS, 1034 CR Amsterdam), date and time (10/10/2026 16:52), the VAT table (0%: 0,00 on 0,25; 9%: 4,69 on 56,76; 21%: 1,30 on 7,49; total 5,99 on 64,50), card payment and "14 Artikelen" correctly.
- It also misread the printed total as `664,50` (the euro sign became a 6), garbled most product names (for example "HORLOGEEN WOEL HEIK" for the milk) and dropped the discount line ("-3,00").
- The KIE answer gave the total `64,50`, shop PLUS SLOOTEN, 14 lines without VAT rates and no VAT rows. The parser stored gross 6450, 14 lines and no VAT rows, and flagged `gross_sum`, `rounding_format`, `vat_row_unreadable`, `vat_missing_rate`. The zero-false-`done` gate held: nothing wrong reached `done`.
- Both outputs came from one photo, so this is one data point, not an accuracy measurement.

Open from this check:
- A photo where the receipt fills little of the frame can take longer than the worker's 120 s request timeout and keep the upload in `processing` for minutes before failing, without telling the buyer to retake the photo. Cropping to the receipt fixed it. Not fixed here.
- The parser did not use the markdown VAT table of the real receipt: its rows read `BTW lang 9% 4,69 56,76` and `BTW 0 0,00 0,25` (no percent sign), unlike the mock layout. Making the table parser tolerant of the PLUS layout is not done.
- The real photo contains a masked card number (`516882xxxxxx9944`), so it was left untracked in the repo root. Whether to add it to `fixtures/receipts-nl/` with a hand-written truth file is the user's call.
- The Colab tunnel and 100 s edge limit make this setup suitable for demos only.

# Handoff to reviewer

## What works end to end, and the test that proves it

| Capability | Proof |
| --- | --- |
| Receipt journey: offline create + QR, pending, upload, Mailpit login, claim, wallet, v3 paid final, `notify-version` enqueued, archive, VAT per rate | `pnpm test:journey` (6 hops); also vitest wrapper in `apps/merchant-api/test` |
| Outside oracles: RFC 8032 §7.1 (5 vectors), RFC 8785 (6 cyberphone files), UUIDv7 bits | `pnpm --filter @lr/crypto test` (17) |
| Dutch corpus rules, line kinds, misfit list in both directions | `pnpm --filter @lr/receipt-nl test` (173), **MOCK** corpus |
| Extraction eval, zero false `done` gate | `pnpm eval:extraction` (**MOCK**: 4 done, 2 needs_review, 0 false done) |
| Privacy: roles, RLS, canary | `pnpm --filter @lr/db test` (70), `pnpm test:privacy` |
| Lifecycle, idempotency, 409s, version gap + batch, resolve rate limits, claim conflicts/expiry/race | `pnpm --filter @lr/merchant-api test` (116), `pnpm --filter @lr/buyer-api test` (75) |
| Offline queue, ordered flusher, crash test (SIGKILL mid-batch, exactly once, in order), identifier stripping | `pnpm --filter @lr/terminal-sdk test` (119) |
| Worker: upload to done/needs_review, matching, leads by KvK, notify push (decrypted), export vs seed, retention, categorise | `pnpm --filter @lr/worker test` (56) |
| Dashboard: argon2 + TOTP login, roles, terminals, reports, archive RLS | `pnpm --filter @lr/dashboard-core test` (29), `pnpm --filter @lr/merchant-web test` (13) |
| Wallet units (link parser, pending-claim store, retry), service worker + manifest in build | `pnpm --filter @lr/wallet test` (83), `pnpm --filter @lr/wallet build` |
| Browser E2E (all four §16.G scenarios) | `pnpm test:e2e`: 4 passed in 22.0 s |

## What is partial or broken, and why

See "Open" at the top of this file. In short: no real corpus (all accuracy numbers are MOCK); the Qianfan http extractor, real push delivery, a real phone camera, iOS/Safari and browser-to-S3 uploads are unverified; PDF/HEIC uploads are not extracted; the three v2 known issues are untouched by instruction; `resolve/view` stays readable after a claim; journey hop 6 is in-process.

## Departures from v2

All are in `docs/DECISIONS.md` (marked **DEPARTURE** where they differ from v2). The main ones:

- S3 service is `adobe/s3mock` instead of MinIO (section "Environment").
- pg-boss lives in schema `pgboss`, not `ops` (section "Database").
- Services run TypeScript directly (Node type stripping); `build` is `tsc` or `nuxt build` (section "Build & tooling").
- Unknown receipt id returns `pending`, not 404 (section "Buyer API").
- `receipt_lines` is maintained by merchant-api at ingest (section "Database").
- Wallet `pnpm dev` serves a production build so the service worker exists; HMR via `dev:hmr` (section "Decisions by area", e2e).
- Playwright pinned to 1.63.0 (the installed Chromium), not 1.64 (section "Decisions by area", corpus).
- Per-area departures: sections "corpus", "integration", "worker", "wallet", "merchant-web", "e2e" under "Decisions by area".

## Commands to reproduce

```sh
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:journey
pnpm test:privacy
pnpm eval:extraction
# final Playwright check (DIRECTIONS §6a), run last:
docker compose down -v && docker compose up -d && pnpm db:migrate && pnpm db:seed
pnpm dev            # in one terminal; wait until http://127.0.0.1:3001 answers
pnpm test:e2e       # in another; then: pnpm e2e:report
```

## Playwright report and screenshots

- Report: `docs/e2e-report/index.html` (open in a browser; traces are inside).
- Screenshots: `docs/e2e-screenshots/*.png`.
