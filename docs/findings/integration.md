# Findings: integration tests, privacy canary, hardening

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
| Terminal clock backdating | `threats.test.ts › the claim window runs from the server received_at …` | `claimable_until = received_at + CLAIM_WINDOW_DAYS` using the **server** clock for terminal receipts dated 2020-01-01, 2099-01-01 and now alike (90 days to 6 decimals). A 2020-dated receipt is claimable today. **`createdAt` is stored exactly as sent**: no check against the server clock, no skew bound, so a terminal (or one with a wrong clock) decides the date the buyer sees, how the receipt sorts in the wallet and which `from`/`to` filter it matches (tested). Whether the dashboard archive, reports and BTW export bucket by this terminal date was not tested here. Open: v2 left the choice undecided; a bound such as ±24 h would be a product decision |
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
