# Build prompt: Digital Receipts Platform MVP — Netherlands, end to end

You are building the MVP of a digital receipts platform in one unattended run. Work on your own. Where this spec says nothing, make a reasonable decision, record it in `docs/DECISIONS.md` and keep going. Do not stop to ask questions.

The goal of this run is **one thin path that is real from end to end, checked by outside oracles**. It is not a wide feature surface. When depth and breadth compete, choose depth on the path below and list what you cut under "Deferred".

**Receipt corpus: mock first, real later.** There is no real corpus yet. Do this:
- **Build the mock corpus.** Create `fixtures/receipts-nl/mock/` with 6 synthetic kassabonnen covering: horeca with mixed 9%/21%, a supermarket receipt with statiegeld and a bonus line, a weighed item, cash rounding, a return, and one receipt with no BTW-id (KvK only).
  - For each one, write `<id>.truth.json` (Appendix A format, plus `"mock": true`).
  - Render `<id>.png` from an HTML kassabon template with a Playwright screenshot.
  - Write `<sha256>.qianfan.json` with `"modelRevision": "mock"`, made to look like Qianfan output.
  - Plant realistic OCR errors in 2 of them: one digit misread in a total, and one missing BTW line. These two must end in `needs_review`.
- **Pick the corpus automatically.** Tests §16.C/D and the seed use real files in `fixtures/receipts-nl/*.truth.json` when they exist, and fall back to `mock/` otherwise. Print which corpus was used.
- **Label mock results.** In `FINDINGS.md`, every number computed from mock data is labelled **MOCK**, and `pnpm eval:extraction` prints `MOCK CORPUS — not a real accuracy measurement` when it falls back.
- **Real files are read-only.** Never edit or create files outside `mock/`. The human adds the real ones later (Appendix A); the code must not change when they arrive.

## Handoff notes (read first)

You start without the planning conversation. Everything you need is in this repo.

**Source files, in order of authority:**
1. This file.
2. `coding-agent-prompt.md` ("v1"), only for sections this file says are "as in v1".
3. `Digital Receipts Platform — Technical Design.md` ("the design doc"), only for table columns this file refers to.

Where they conflict, this file wins. v1 and the design doc are written for Italy, Expo/React, NFC and AWS. Ignore those parts.

**Decisions already made (do not reopen):**
- Netherlands only.
- Vue/Nuxt, with the buyer side as a PWA (no native app).
- QR only; NFC is deferred.
- Qianfan-OCR for photos.
- Hosting is undecided, so add no infra or deploy config. Keep the apps deployable as plain Node servers, with Nuxt on Nitro's default node preset.

**Environment (checked 2026-10-16):**
- macOS arm64, Node 22.23.1 (nvm), pnpm 12.14.0 via corepack (`packageManager` field in root `package.json`).
- Docker Desktop must be running.

**Pinned majors.** Use exact or caret ranges within these, and do not upgrade majors:
- `typescript` 6.0.3. TS 7 is out, but typescript-eslint supports `<6.1`.
- `zod` 4, `@asteasolutions/zod-to-openapi` 9.1.
- `fastify` 5, `fastify-type-provider-zod` 7.
- `drizzle-orm` 0.45 (not the 1.0 beta) and `drizzle-kit` 0.31.
- `pg-boss` 12 (needs Node ≥ 22.12), `pg` 8.
- `nuxt` 4, `@vite-pwa/nuxt` 1, `tailwindcss` 4 via `@tailwindcss/vite`.
- `vitest` 5, `@nuxt/test-utils` 4, `@playwright/test` 1.64.
- `@noble/ed25519` 3, `@noble/hashes` 2, `canonicalize` 5, `uuidv7` 1.
- `better-sqlite3` 13, `web-push` 3, `pdfmake` 0.3, `@node-rs/argon2` 2, `otpauth` 9, `nodemailer` 10.
- `@aws-sdk/client-s3` 3, `turbo` 2, `eslint` 10.

If one of these doesn't work together with another, pick the nearest working version, and record the error and the choice in `DECISIONS.md`.

**For the reviewer who checks your work afterwards:**
- Make one commit per step in §0, with a message naming the step. Never squash or rewrite history.
- Keep a **Verification log** section in `docs/FINDINGS.md`. For every check you run, record the exact command, pass/fail and the counts (e.g. "142 passed, 0 failed"). Copy them from real output only.
- Record every departure from this file in `DECISIONS.md` with the reason. A silent departure counts as a defect.
- **Known open issues.** Do not fix these unless this file is updated; list them in `FINDINGS.md` under "Open":
  - `claimSecretHash` is not covered by the receipt signature.
  - The server does not yet check that `merchant.terminalId`/`locationId` in the receipt match the authenticated terminal.
  - It is undecided whether the claim window uses terminal time or server time. Use server `received_at` for now.

## 0. How to work

1. **Walking skeleton first.** Build the thinnest version of the golden journey (§16.A) through every tier: schema → crypto → db/roles → merchant-api → terminal-sdk → buyer-api/resolver → claim → wallet read. Do this before you thicken any layer. Commit when `pnpm test:journey` passes.
2. Then thicken in this order: lifecycle and versions → offline queue → worker and photo extraction → wallet (PWA) and receipt viewer → simulator → dashboard → CI → docs.
3. Commit after each step with every test passing. Never weaken a test to make it pass. Record the failure in `docs/FINDINGS.md` instead.

## 1. What the product does

- Merchants in the **Netherlands** send every receipt (kassabon) to us through an API. We store it **under the merchant's identity only**. A receipt never contains a buyer identifier.
- Buyers use a free **wallet web app**: a Vue PWA that can be installed to the home screen, with no app store. At the till they **scan the QR code** with the phone's own camera, which opens the receipt link in the wallet. A confirmation sheet asks "Save this receipt?" and shows the merchant, total and time. On Save, the receipt goes into the buyer's wallet.
- **NFC is out of scope for this run** (see Deferred). Keep the claim flow independent of how the buyer arrived, so an NFC entry point can be added later without changing claims.
- Receipts have a **lifecycle with immutable versions**. A `presented` receipt is a pre-bill (the horeca "rekening"). It can be claimed and then updates live until it is final.
- Everything must work with **poor or no connectivity** on both the merchant side and the buyer side.
- Buyers can **upload photos or PDFs of old paper receipts**. These are extracted with **Qianfan-OCR** (`baidu/Qianfan-OCR`, 4B, Apache-2.0), served outside this repo (Appendix A). Unknown merchants are counted as sales leads.
- Merchants get a **dashboard**: setup, archive, reports and exports. The dashboard **never** shows who claimed a receipt.

**Dutch context (verify each against the corpus; the corpus wins):**
- There is no mandatory fiscal cash register in NL. The horeca KBA mark is voluntary. So `paid` is the final state for NL receipts.
- BTW rates are 21% and 9% (food and non-alcoholic drinks; alcohol is 21%), plus 0% and out of scope.
- Shelf prices include VAT, and receipts print a BTW breakdown per rate.
- Cash totals are commonly rounded to €0.05.
- Statiegeld (bottle deposit) lines are treated as outside VAT.
- Supermarket loyalty discounts ("bonus") appear as negative lines.
- Many kassabonnen show a KvK number. Some show no BTW-id.
- The bookkeeping retention period is 7 years.

## 2. Non-negotiable rules

1. No buyer identifier anywhere in the `merchant` schema, the CRF, merchant API responses or the dashboard. The only person ↔ receipt link is `buyer.claims`.
2. **No free-text field in CRF** (no `notes`). `lines[].description` is limited to 80 characters. The terminal SDK mapping must drop loyalty-card numbers, masked PANs and customer names. Test this with fixtures.
3. Enforce rule 1 with **separate Postgres roles** per service (§7) and row-level security on `merchant` tables by `org_id`.
4. Claim secrets are 256-bit random values generated **on the terminal**. Store only `sha256(secret)` as hex. Compare in constant time. Secrets never appear in logs.
5. The receipt URL is `https://<RECEIPT_HOST>/r/<receiptId>#<secret>`. Because the secret is in the **fragment**, it never reaches a server. The wallet reads it on the client, POSTs it in a request body, and then removes it from the address bar with `history.replaceState`.
6. Money is integer euro cents plus an ISO 4217 currency. Timestamps are UTC `timestamptz`. Times printed on receipts are `Europe/Amsterdam` and converted to UTC.
7. Receipt IDs are **UUIDv7 generated on the terminal**. Uploads are idempotent on `(receiptId, version)`. The same key with different content returns 409 and is audit-logged.
8. Every receipt version is signed by the terminal's **Ed25519** key over the **RFC 8785 (JCS)** canonical JSON of the CRF payload. The server verifies the signature against the registered public key.
9. Logs contain request IDs only. They never contain secrets, tokens, emails or receipt content.

## 3. Tech stack (fixed)

- **Monorepo:** pnpm workspaces + Turborepo, strict TypeScript, Node 22 LTS.
- **Shared:** `packages/schema` holds the Zod schemas for CRF and DTOs. Generate OpenAPI with `zod-to-openapi` and serve it at `/docs` for each API.
- **Backend:** Fastify, Drizzle ORM + drizzle-kit, PostgreSQL 16, pg-boss.
- **Frontend:** Vue 3 + Nuxt (latest stable) + Tailwind, `<script setup>` with TypeScript. Two Nuxt apps: `merchant-web` (dashboard and POS simulator) and `wallet` (receipt viewer and buyer wallet, served on `RECEIPT_HOST`).
- **Wallet PWA:** `@vite-pwa/nuxt` for the service worker and manifest, `idb` for the IndexedDB offline cache, and Web Push with VAPID keys (`web-push` on the server). No native app and no in-app QR scanner, because the phone's camera opens the link.
- **PDF:** server-rendered in buyer-api with `pdfmake`.
- **Crypto:** `@noble/ed25519`, `@noble/hashes`, `canonicalize`, `uuidv7`.
- **Extraction:** Qianfan-OCR behind an `Extractor` interface (§11). No other OCR or LLM vendor.
- **Storage:** S3 API (MinIO locally).
- **Testing:** Vitest everywhere (`@nuxt/test-utils` for the Nuxt apps) with a real Postgres from docker compose, and Playwright for browser E2E, including mobile device emulation.
- **CI:** GitHub Actions running lint, typecheck, tests and build.

## 4. Repository layout

```
apps/
  merchant-api/  buyer-api/  worker/
  merchant-web/    Nuxt: dashboard + POS simulator
  wallet/          Nuxt PWA on RECEIPT_HOST: /r viewer + buyer wallet
packages/
  schema/  db/  crypto/  terminal-sdk/  config/
  receipt-nl/      Dutch receipt rules: BTW math, rounding, ID formats, text normaliser
tools/qianfan/     colab_extract.ipynb (batch) + serve.md (vLLM endpoint)
fixtures/receipts-nl/   human-provided corpus (Appendix A), read-only to you
scripts/           journey.ts, eval-extraction.ts, leads-report.ts
docs/              README, ARCHITECTURE, DECISIONS, API, FINDINGS
docker-compose.yml Postgres 16, MinIO, Mailpit
```

## 5. Canonical Receipt Format (CRF v1, NL)

```json
{
  "crf": "1",
  "receiptId": "uuidv7",
  "version": 1,
  "state": "open|presented|paid|fiscalised|void",
  "merchant": { "kvkNumber": "12345678", "vatNumber": "NL123456789B01|null", "name": "Café Het Plein", "locationId": "uuid", "terminalId": "uuid" },
  "createdAt": "ISO-8601 UTC",
  "currency": "EUR",
  "lines": [{ "lineNo": 1, "kind": "item|discount|deposit", "sku": "KOF", "description": "Koffie", "qty": "2", "unitPrice": 340, "vatRate": 9, "discount": 0, "total": 680, "category": "dining" }],
  "vatSummary": [{ "rate": 9, "gross": 680, "net": 624, "vat": 56 }],
  "totals": { "gross": 680, "net": 624, "vat": 56, "tip": 0, "rounding": 0 },
  "payments": [{ "method": "card|cash|other", "amount": 680 }],
  "fiscal": { "country": "NL", "registerSerial": null, "documentNumber": "bonnummer|null", "extra": {} },
  "voidOf": null
}
```

Rules, implemented once in `packages/receipt-nl` and used by the API, worker and SDK:
- `qty` is a decimal string with at most 3 decimals (weighed items). `total = roundHalfUp(qty × unitPrice) − discount`. Prices include VAT.
- `kind: discount` lines have a negative total. `kind: deposit` lines have `vatRate: null` and are left out of `vatSummary`.
- `sum(lines.total) == totals.gross`.
- For each rate, `vat = roundHalfUp(rateGross × r / (100 + r))` and `net = rateGross − vat`. Round per rate total, not per line. **Check this rule against the printed BTW on every corpus receipt.** If the corpus shows per-line rounding, switch to it and record the evidence.
- `totals.rounding` is signed cents, non-zero only with a cash payment, and `|rounding| ≤ 2`.
- In `paid`, `sum(payments) == gross + tip + rounding`.
- `vatRate ∈ {21, 9, 0, null}`. KvK is 8 digits. The BTW-id format is `NL\d{9}B\d{2}`, format-checked only (no checksum).
- `fiscalised` is rejected for NL organisations and kept for future countries.

## 6. Lifecycle

- Allowed transitions: `open→presented`, `presented→presented`, `open|presented→paid`, `paid→fiscalised` (non-NL only), any→`void`. A receipt may start at `open`, `presented` or `paid`.
- Versions start at 1 and increase by exactly 1. A gap returns 409 `version_gap`.
- `open` receipts are never visible to resolvers.
- `presented` renders with a "Geen definitieve bon / Not a final receipt" banner.
- When a claimed receipt gets a new version, the worker pushes to its owner. If the new state is final for that country (`paid` in NL), the text says the receipt is final.

## 7. Database

Create the schemas `merchant`, `buyer`, `leads` and `ops`. They have the same tables as the design doc, with these changes:
- `organizations` gets `kvk_number unique not null`, `vat_number unique null` and `retention_years default 7`.
- `daily_rollups` holds gross, and BTW per rate, count and voids per location per day.
- `buyer.passkeys` is removed (deferred).
- `buyer.devices` is replaced by `buyer.push_subscriptions(id, user_id, endpoint unique, p256dh, auth, user_agent, created_at, last_seen_at)`.
- `buyer.claims.source` is `qr|link|photo_match`.
- There are no `nfc_tags` or `tap_sessions` tables. Add them later by migration.
- `leads.unknown_merchants` is keyed by `merchant_key`, which is the first that exists of `vat:<btw-id>`, `kvk:<kvk>`, or `name:<normalised name>|<postcode>`. `unknown_merchant_uploaders(merchant_key, user_id)` is used for distinct counting.

**Roles** are created in migrations from env passwords:
- `merchant_api`: read/write `merchant` (RLS by org), write `ops`. No access to `buyer` or `leads`.
- `buyer_api`: read/write `buyer`, write `leads` and `ops`. Read-only on `merchant.receipts`, `receipt_versions`, `locations` and `organizations(name, kvk_number, vat_number)`.
- `worker`: the same as `buyer_api`, plus write on rollups, `buyer.uploads` and `leads`. Column grants exclude password, TOTP and key columns.
- `dashboard`: read/write `merchant` (RLS by org) and read rollups. No access to `buyer`.

`merchant_api` and `dashboard` set `app.org_id` on every request.

## 8. Terminal SDK

The SDK is the same as v1:
- `createReceipt` returns `{receiptId, secret, qrUrl}` before any network call.
- `addVersion`.
- A SQLite queue (`better-sqlite3`; IndexedDB in the browser simulator, behind the same interface).
- An ordered flusher: single uploads, or `POST /v1/receipts:batch` with at most 500 items, with exponential backoff, jitter and a stable `Idempotency-Key` per version.
- `qrUrl` plus an SVG QR.
- `pnpm --filter terminal-sdk demo`.

Change for NL: the SDK runs drafts through `receipt-nl` validation before signing and strips forbidden identifiers (§2.2).

## 9. Merchant API

Unchanged from v1: auth with a Bearer terminal key, `X-Terminal-Id` and `X-Signature`. The endpoints are `POST /v1/receipts`, `POST /v1/receipts/:id/versions`, `POST /v1/receipts:batch` (per-item results), `GET /v1/receipts/:id` (own org only) and `GET /v1/terminals/me`. Idempotency works as in v1. `claimable_until = received_at + CLAIM_WINDOW_DAYS` (default 90).

## 10. Buyer API + public resolver

- **Public:** `POST /v1/resolve/secret` and `POST /v1/resolve/view` behave as in v1, with the same 404 for a wrong ID or a wrong secret. Rate limits are 30 requests/min per IP and 10 failed secrets per receipt per hour.
- **Authenticated** (email code via Mailpit; opaque session tokens stored hashed):
  - `/v1/auth/email/start|verify`
  - `POST /v1/me/claims` (by `{receiptId, secret}`; `already_claimed`; idempotent for the same user; rejected after `claimable_until`)
  - `GET /v1/me/receipts` (cursor, filters, search)
  - `GET /v1/me/receipts/:id`
  - uploads: presign, `complete`, `PATCH` corrections, `accept-match`
  - `GET /v1/me/insights` (spend per month, per category and top merchants only)
  - `PUT /v1/me/consents`, `POST /v1/me/push-subscriptions` and `DELETE /v1/me/push-subscriptions/:id`, `GET /v1/me/export`
  - `GET /v1/me/receipts/:id/pdf`
  - `DELETE /v1/me` (soft-delete; hard-delete after 30 days)

## 11. Worker

- **`extract-upload`:** fetch the file from S3 and call `Extractor.extract(bytes) → { markdown, kie, modelRevision }`.
  - Implementations:
    - `EXTRACTOR=recorded` reads `fixtures/receipts-nl/<sha256(bytes)>.qianfan.json`. It is used in tests and the seed.
    - `EXTRACTOR=http` POSTs the image to `QIANFAN_URL`, an OpenAI-compatible `/v1/chat/completions` endpoint from `vllm serve baidu/Qianfan-OCR` (see `tools/qianfan/serve.md`). It sends the two fixed prompts from Appendix A.
    - There is no fake extractor.
  - Then a deterministic `receipt-nl` parser turns the output into a CRF draft. It handles Dutch decimals (`1.234,56`), BTW breakdown lines, statiegeld, bonus lines and cash rounding.
  - Run Zod validation and the §5 arithmetic with a 2-cent tolerance. The result is `done` only if every check passes **and** the printed total and per-rate BTW agree with the line sum. Otherwise the result is `needs_review`.
  - **Matching:** if the extracted KvK or BTW-id belongs to an organisation and an unclaimed receipt has the same gross within ±30 minutes, set `matched_receipt_id`. Otherwise upsert the lead by `merchant_key`. At `LEAD_THRESHOLD` distinct uploaders (default 20), set the status to `new`.
- **`notify-version`:** on a new version of a claimed receipt, send a Web Push to each of the owner's subscriptions with `web-push`. Delete subscriptions that return 404/410.
- **`rollup-daily`:** as in v1.
- **`export`:** CSV per period, plus an accountant CSV with BTW per day and per period, using columns that map to aangifte rubriek 1a (21%), 1b (9%) and 1e (0% / out of scope). Upload to S3 and return a link valid for 24 hours.
- **`retention`:** delete receipts older than the org's `retention_years`, hard-delete buyers 30 days after deletion, and expire email codes.
- **`categorise`:** a keyword rule table with Dutch keywords. Flag `apotheek`/`drogist`-health lines as sensitive.

## 12. Merchant web (`apps/merchant-web`, Nuxt)

- **`/dashboard`:** email, password and TOTP login, with TOTP enrolled at first login. Pages:
  - organisation (KvK, BTW-id, retention)
  - locations
  - terminals (create, show the key once, register the public key, revoke)
  - archive (search, filters, versions, PDF)
  - reports (daily and monthly sales, BTW per rate, voids)
  - exports
  - users and roles (owner, manager, accountant read-only)
- **`/simulator`:**
  - a horeca grid (koffie and appeltaart at 9%, bier and wijn at 21%) and a cart
  - Present, Add item, Pay card, Pay cash (applies 5-cent rounding), Void
  - a big QR, sized to scan from a phone held 30–50 cm from a laptop screen
  - an Offline toggle
  - No Fiscalise button for NL orgs.
- No `/admin`. Leads come from `pnpm leads:report` (counts only).

## 13. Wallet (`apps/wallet`, Nuxt PWA on `RECEIPT_HOST`)

- **`/r/[id]`:**
  - Reads the secret from `location.hash`, then strips it from the URL (§2.5).
  - If the buyer is not logged in, it renders the receipt read-only through `resolve/view`, with a "Save to wallet" button that starts the email-code login and returns to the sheet.
  - If logged in, it shows the confirmation sheet ("Bon opslaan?" / "Niet van mij") → claim.
  - Renders lines, BTW per rate, totals, rounding, payments and version history, the pre-bill banner, and a pending state with auto-retry. A PDF download is available.
  - Mobile-first and accessible.
- **Onboarding:** email code, consents all off, an optional push opt-in, and an "Add to Home Screen" hint. On iOS, Web Push works only after the app is installed to the Home Screen (iOS 16.4+). Show this in the UI rather than failing silently.
- **Wallet:**
  - grouped by day
  - search and filters
  - an "Arriving" section
  - receipt detail with versions
  - a push notification opens the detail
- **Add receipt:** `<input type="file" accept="image/*,application/pdf" capture="environment">` → upload → status → a correction form for `needs_review` → "Official receipt found — replace?"
- **Insights:** simple charts as hand-written SVG Vue components, with no chart library.
- **Settings:** consents, export, delete account, logout.
- **Offline:**
  - The service worker precaches the app shell, and IndexedDB caches receipts for offline reading.
  - Pending claims `{receiptId, secret, createdAt}` are stored in IndexedDB. They retry on app open, on the `online` event and on `visibilitychange`, for up to 7 days, then show "Couldn't get this receipt — ask the shop".
  - No Background Sync API (Safari doesn't support it).

## 14. Security

- argon2id for passwords. API keys and session tokens are 32 random bytes, shown once and stored as SHA-256.
- A `KeyProvider` interface with a local AES-256-GCM env key encrypts the TOTP secrets.
- The VAPID private key comes from env and is never logged.
- Strict headers and CORS, size limits, Zod validation on every input.
- `@fastify/rate-limit` with the store choice documented.
- Logger redaction for `authorization`, `secret`, `email`, `payload` and `token`.
- Audit entries for: key create/revoke, claim, failed signature, idempotency conflict and account deletion.

## 15. Local dev, seed, docs

- `docker compose up -d && pnpm i && pnpm db:migrate && pnpm db:seed && pnpm dev` starts everything.
- The seed creates:
  - org "Café Het Plein" (fake KvK and BTW-id with valid formats), 1 location and 2 terminals
  - `owner@example.test` and `buyer@example.test`
  - 200 receipts over 60 days with mixed 9%/21% rates and some cash rounding, 30 of them claimed
  - 3 uploads using corpus images with the `recorded` extractor, one of which matches an official receipt
- Each app has a `.env.example` and validates its env with Zod at startup.
- Docs:
  - `README.md`:
    - quickstart
    - the phone demo: open the simulator on a laptop, scan the QR with the phone camera, Save, wallet, edit, push, final; on the same Wi-Fi, use `RECEIPT_HOST` set to the laptop's LAN address over HTTPS, or a tunnel
    - how to run Qianfan
    - a one-paragraph "NFC later" note
  - `ARCHITECTURE.md`: Mermaid diagrams of the flows and roles.
  - `API.md`.
  - `DECISIONS.md`: every choice, plus "Deferred".
  - **`FINDINGS.md`:**
    - corpus misfits (receipt ID, which rule broke)
    - the extraction accuracy table
    - the threat list:
      - shoulder-surfed or photographed QR at the till
      - a shared or forwarded receipt link
      - the secret left in browser history or a share sheet
      - claim race
      - terminal clock backdating
      - versions signed offline before a key was revoked
      - free text that could carry identifiers
    - each with the test or measurement that covers it, or "uncovered"
  - This file is where the next round of depth gets chosen.

## 16. Tests (all must pass unattended)

**A. Golden journey (`pnpm test:journey`), headless, one process driving real services over HTTP:**
1. The SDK creates a presented receipt while the API is unreachable, and the QR URL exists.
2. Resolving by secret returns `pending`.
3. The API comes back, the flusher uploads, and resolve returns the preview.
4. A buyer logs in through a Mailpit code, claims the receipt, and sees it in the wallet.
5. The SDK adds an item, then pays in cash with rounding. The wallet shows v3 `paid` as final, and `notify-version` was enqueued.
6. The receipt appears in the dashboard archive and in the BTW export with the correct per-rate amounts.

Print each hop with its status.

**B. Outside oracles:**
- RFC 8032 §7.1 Ed25519 vectors.
- RFC 8785 test data (cyberphone/json-canonicalization) through `canonicalize`.
- UUIDv7 timestamp/version bits per RFC 9562.

**C. Dutch corpus:**
- For every `*.truth.json`, `receipt-nl` reproduces the printed per-rate BTW, gross and rounding to the cent.
- Expected misfits are listed in `fixtures/receipts-nl/known-misfits.json`, each with a reason that you write. The test fails if the actual misfits differ from that list in either direction.
- Every corpus line kind (statiegeld, bonus, weighed item, cash rounding, return) has at least one passing receipt. Otherwise it is listed as uncovered in FINDINGS.

**D. Extraction eval (`pnpm eval:extraction`, also run in tests):**
- Run the recorded Qianfan outputs through the parser and compare with the truth. Write per-field accuracy (merchant key, date/time, gross, BTW per rate, payment method, line count) to FINDINGS.
- **Gate: zero false `done`.** No receipt may reach `done` with a gross or per-rate BTW that differs from the truth. Accuracy is reported, not gated.

**E. Privacy:**
- Connected as `merchant_api` and as `dashboard`, every `SELECT` on `buyer.*` fails.
- RLS stops org A from reading org B.
- **Canary run:** run journey A with a unique canary email and secret. Afterwards, search all service logs, a `pg_dump` of the `merchant` schema, and every merchant API and dashboard response captured during the run. There must be zero hits for the canary email, the secret, the user ID and the session token.
- An SDK mapping fixture with a loyalty-card number, a masked PAN and a name is stripped before signing.

**F. Integration (real Postgres):**
- The lifecycle table, including `fiscalised` rejected for NL.
- Idempotent replay and the 409 conflict.
- Version gap, then batch fill.
- The resolve rate limit.
- Claim conflicts and expiry.
- Upload match → accept-match.
- A lead keyed by KvK when the BTW-id is missing crosses the threshold.
- Deletion, then the retention job: claims are gone and merchant receipts remain.
- The export matches the seed.
- **Crash test:** kill the flusher process mid-batch, restart it, and the server holds each version exactly once and in order.

**G. Browser E2E (Playwright):**
- **Buyer journey on a phone:**
  - The simulator in a desktop context presents a sale.
  - A second context, using Playwright's `iPhone 13` device descriptor, opens the `/r/...#secret` URL taken from the QR, sees the pre-bill banner, logs in with the Mailpit code and saves.
  - The URL no longer contains the fragment, and the receipt is in the wallet.
  - The simulator pays, and the wallet shows the final version after reload.
  - A test push endpoint receives exactly one encrypted push for the new version.
- **Buyer offline:**
  - Set the phone context offline with `context.setOffline(true)`, then open a receipt link: it shows as "Arriving".
  - Go back online: the claim completes.
  - Already saved receipts still render while offline.
- **Merchant offline:** Offline toggle in the simulator, 3 sales, back online: all 3 appear in the dashboard archive.
- **Dashboard:** TOTP login; create a terminal; the key is shown once; revoke it.

**H. Wallet units (Vitest):** the link/fragment parser, the pending-claim store and the retry logic. `nuxt build` succeeds for both Nuxt apps, and the wallet build includes the service worker and manifest.

## 17. Definition of done

- From a clean clone, `pnpm lint && pnpm typecheck && pnpm test && pnpm build` passes, and so do `pnpm test:journey`, `pnpm eval:extraction` and Playwright against `pnpm dev`. The CI workflow is included.
- `docs/FINDINGS.md` exists with numbers from this run, not estimates. Numbers from the mock corpus are labelled MOCK.
- There are no TODOs in claims, signatures, idempotency, RLS/roles, the offline queues (terminal and wallet) or `receipt-nl`.
- **Deferred** (listed in DECISIONS):
  - Terraform/AWS (and region choice for NL)
  - RUNBOOK
  - passkeys
  - price-change insights
  - sales-by-hour, top-items and average-ticket reports
  - `/admin` UI
  - NFC: v1 stickers (NTAG 424 DNA with SUN) and the v2 pad
  - native apps (Capacitor wrapper around the same Vue wallet)
  - in-app QR scanner
  - Background Sync
  - certified fiscal integrations
  - Open Banking matching
  - bill splitting
  - social features
  - data products
  - ERP connectors
- The phone demo in the README is mostly covered by test G. Two things are not verified by this run: a real phone camera scanning the QR, and real push delivery to a device. Say so in the README.

## Appendix A — Real corpus (human, can arrive after the build)

Start with a single receipt; that is enough to replace one mock. Over time, aim for 30–100.

1. Photograph Dutch kassabonnen into `fixtures/receipts-nl/<id>.jpg`. Cover supermarket, horeca, drogist/apotheek, multi-rate, statiegeld, bonus, weighed items, cash rounding and a return. Remove nothing from the images. The repo stays private.
2. For each photo, write `<id>.truth.json` by hand, copying exactly what is printed:
   ```json
   { "id": "…", "image": "<id>.jpg", "sha256": "<of image bytes>",
     "merchant": { "name": "…", "kvk": "…|null", "vatNumber": "…|null", "postcode": "…|null" },
     "printedAt": "2026-10-01T17:42 (local, as printed)", "gross": 1999, "rounding": 0,
     "vat": [{ "rate": 9, "printedBase": 1834, "basis": "excl|incl", "vat": 165 }],
     "payments": [{ "method": "card|cash|other", "amount": 1999 }],
     "lines": null, "quirks": ["statiegeld", "bonus", "weighed", "cash-rounding", "return"] }
   ```
   Fill `lines` where you can, aiming for at least 10 receipts with lines once the corpus grows.
3. On Colab (L4/A100 runtime; on a T4 use `torch_dtype=torch.float16`), run `baidu/Qianfan-OCR` on every image with `do_sample=False` and these two prompts:
   - `Parse this document to Markdown.`
   - `Extract from this Dutch receipt as JSON: merchant_name, kvk_number, btw_number, postcode, date, time, lines[{description, qty, unit_price, total, btw_rate}], btw_breakdown[{rate, base, btw}], total, rounding, payment_method. Use null for missing fields. Copy numbers exactly as printed.`

   Save `<sha256>.qianfan.json` as `{ "modelRevision": "<HF commit>", "markdown": "…", "kie": "<raw string>" }`.
