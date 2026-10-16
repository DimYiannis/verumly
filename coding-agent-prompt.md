# Build prompt: Digital Receipts Platform MVP

You are building the complete MVP of a digital receipts platform in one go. Work autonomously. Make reasonable decisions where this spec is silent, record each one in `docs/DECISIONS.md`, and keep going. Do not stop to ask questions. The finished repo must install, run locally, pass all tests, and demo the full flow end to end.

## 1. What the product does

- Merchants send every receipt to us through an API. We store it **under the merchant's identity only**. A receipt never contains any buyer identifier.
- Buyers use a free mobile app. They claim a receipt by **scanning a QR code** or **tapping an NFC sticker** at the till. The app shows a confirmation sheet ("Save this receipt?" with merchant, total, time). On Save, the receipt is assigned to the buyer and appears in their wallet.
- Receipts have a **lifecycle with immutable versions**: `open → presented → paid → fiscalised`, plus `void`. A `presented` receipt is a pre-bill (like a restaurant check shown before paying). It can be claimed and then updates live until final.
- Everything must work with **poor or no connectivity** on the merchant side and the buyer side.
- Buyers can **upload photos/PDFs** of paper receipts. A worker extracts them to structured data with the Claude vision API. Unknown merchants (by VAT number) are counted as sales leads.
- Merchants get a **dashboard**: setup, archive, reports, exports. The dashboard **never** shows who claimed a receipt.

## 2. Non-negotiable rules

1. No buyer identifier anywhere in the `merchant` schema, the Canonical Receipt Format (CRF), merchant API responses or dashboard. The only person ↔ receipt link is `buyer.claims`.
2. Enforce this with **separate Postgres roles** per service (see §7) and row-level security on `merchant` tables by `org_id`. Add a test that proves the `merchant_api` role cannot `SELECT` from any `buyer` table.
3. Claim secrets are 256-bit random values generated **on the terminal**. Store only `sha256(secret)`, hex-encoded. Compare in constant time. Secrets never appear in logs.
4. The receipt URL is `https://<RECEIPT_HOST>/r/<receiptId>#<secret>`. The secret is in the **URL fragment**, so it never reaches servers. The web viewer and the app read it client-side and POST it in a body.
5. Money is integer minor units plus an ISO 4217 currency. Timestamps are UTC `timestamptz`.
6. Receipt IDs are **UUIDv7 generated on the terminal**. Uploads are idempotent on `(receiptId, version)`. The same key with different content is rejected with 409 and audit-logged.
7. Every receipt version is signed by the terminal's **Ed25519** key over the **RFC 8785 (JCS) canonical JSON** of the CRF payload. The server verifies the signature against the registered public key.
8. Logs contain request IDs, never secrets, tokens, emails or receipt content.

## 3. Tech stack (fixed)

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript strict everywhere, Node 22 LTS.
- **Shared:** `packages/schema` holds Zod schemas for CRF and all API DTOs. OpenAPI is generated from them with `zod-to-openapi` and served at `/docs` per API.
- **Backend:** Fastify, Drizzle ORM + drizzle-kit migrations, PostgreSQL 16, pg-boss for jobs.
- **Web:** Next.js (App Router) with Tailwind. It hosts the merchant dashboard, the public receipt viewer and the POS simulator.
- **Mobile:** Expo (React Native, TypeScript), Expo Router, `expo-camera` for QR, `react-native-nfc-manager` for NFC, `expo-sqlite` for the offline cache, Expo push notifications.
- **Crypto:** `@noble/ed25519`, `@noble/hashes`, `canonicalize` (JCS), `uuidv7`. Use AES-CMAC for NTAG 424 SUN verification, implemented with Node `crypto` and covered by test vectors.
- **Storage:** S3 API (MinIO locally) for uploads and exports.
- **Testing:** Vitest for unit and integration tests, with a real Postgres via docker compose (or Testcontainers). Playwright for web E2E.
- **Infra as code:** Terraform for AWS eu-south-1 (ECS Fargate, RDS Postgres 16, S3, CloudFront, WAF, Secrets Manager, KMS). It must `terraform validate`; do not apply it.
- **CI:** GitHub Actions running lint, typecheck, tests, build and `terraform validate`.

## 4. Repository layout

```
apps/
  merchant-api/    Fastify: terminal-facing ingest
  buyer-api/       Fastify: buyer API + public resolver
  worker/          pg-boss jobs
  web/             Next.js: dashboard, /r viewer, /simulator
  mobile/          Expo buyer app
packages/
  schema/          Zod: CRF v1, DTOs, enums
  db/              Drizzle schema, migrations, roles/RLS SQL, seed
  crypto/          signing, JCS, hashing, SUN/CMAC verify
  terminal-sdk/    TS SDK: IDs, secrets, signing, SQLite queue, upload, QR URL
  config/          eslint, tsconfig, shared env loader (zod-validated)
infra/terraform/
docs/              README, ARCHITECTURE, DECISIONS, API, RUNBOOK
docker-compose.yml Postgres 16, MinIO, Mailpit
```

## 5. Canonical Receipt Format (CRF v1)

Implement exactly this in `packages/schema` (amounts in minor units):

```json
{
  "crf": "1",
  "receiptId": "uuidv7",
  "version": 1,
  "state": "open|presented|paid|fiscalised|void",
  "merchant": { "vatNumber": "IT01234567890", "name": "Bar Roma", "locationId": "uuid", "terminalId": "uuid" },
  "createdAt": "ISO-8601 UTC",
  "currency": "EUR",
  "lines": [{ "lineNo": 1, "sku": "ESP", "description": "Espresso", "qty": 2, "unitPrice": 120, "vatRate": 10, "discount": 0, "total": 240, "category": "dining" }],
  "vatSummary": [{ "rate": 10, "net": 218, "vat": 22 }],
  "totals": { "net": 218, "vat": 22, "gross": 240, "tip": 0 },
  "payments": [{ "method": "card|cash|other", "amount": 240 }],
  "fiscal": { "country": "IT", "registerSerial": null, "documentNumber": null, "extra": {} },
  "voidOf": null,
  "notes": null
}
```

Validation rules:
- `qty` may be decimal (string-encoded decimal or number with up to 3 decimals; choose one and document it).
- `sum(lines.total) - discounts == totals.gross - tip` exactly.
- `vatSummary` must match the lines.
- In `paid` and `fiscalised`, payments must sum to gross + tip.
- `fiscal.documentNumber` is required in `fiscalised`.

## 6. Lifecycle rules

- Allowed transitions: `open→presented`, `presented→presented` (new version), `open|presented→paid`, `paid→fiscalised`, any→`void`. A receipt may start at any of `open`, `presented` or `paid`.
- Versions start at 1 and increase by exactly 1. A gap is rejected with 409 `version_gap`; the SDK resends queued versions in order.
- `open` receipts are never visible to resolvers.
- `presented` versions render with a clear "Not a fiscal document" banner in the viewer and the app.
- When a claimed receipt gets a new version, the worker sends a push to the owner. If the new state is `fiscalised`, the text says the receipt is final.

## 7. Database

Create the schemas `merchant`, `buyer`, `leads` and `ops`.

**merchant**
- `organizations`(id, legal_name, vat_number unique, country, plan, created_at)
- `locations`(id, org_id, name, address, lat, lng, timezone)
- `terminals`(id, location_id, org_id, label, api_key_hash, signing_public_key, last_seen_at, revoked_at)
- `nfc_tags`(id, terminal_id, org_id, uid, sdm_key_encrypted, last_counter, active)
- `receipts`(id uuid pk, org_id, location_id, terminal_id, state, current_version, claim_secret_hash, total_minor, currency, created_on_terminal_at, received_at, claimable_until)
- `receipt_versions`(receipt_id, version, state, payload jsonb, signature, created_on_terminal_at, received_at, pk(receipt_id, version))
- `receipt_lines`: denormalised latest version, for reports
- `merchant_users`(id, org_id, email, password_hash argon2id, totp_secret_encrypted, role owner|manager|accountant)
- `daily_rollups` per location/day: gross, vat by rate, count, avg ticket, voids

**buyer**
- `users`(id, email unique, display_name, locale, created_at, deleted_at)
- `passkeys`, `sessions`, `email_codes`
- `devices`(id, user_id, platform, push_token, last_seen_at)
- `claims`(receipt_id unique, user_id, source qr|nfc|link|photo_match, claimed_at)
- `uploads`(id, user_id, s3_key, status queued|processing|done|needs_review|failed, extracted jsonb, confidence, merchant_vat, matched_receipt_id)
- `consents`(user_id, purpose analytics_aggregate|marketing|research_panel, granted, policy_version, changed_at): append-only, current state by latest row
- `tap_sessions`(id, tag_id, candidate_receipt_ids uuid[], expires_at)

**leads:** `unknown_merchants`(vat_number pk, name, address, distinct_uploaders, first_seen_at, status new|contacted|won|lost) plus `unknown_merchant_uploaders`(vat_number, user_id) for distinct counting.

**ops:** `audit_log`, `idempotency_keys`, and the pg-boss tables.

**Roles** (create in migrations, using env-provided passwords):
- `merchant_api`: read/write `merchant` (RLS by org), write `ops`. No access to `buyer` or `leads`.
- `buyer_api`: read/write `buyer`, write `leads` and `ops`; read-only on `merchant.receipts`, `receipt_versions`, `locations`, `organizations(name, vat_number)`, `nfc_tags`. It may update `nfc_tags.last_counter` only.
- `worker`: as `buyer_api`, plus write on rollups, `buyer.uploads`, `leads`. No read on password, TOTP or key columns (use column grants).
- `dashboard`: read/write `merchant` (RLS by org), read rollups. No `buyer`.

The `merchant_api` and `dashboard` services set `app.org_id` per request for RLS.

## 8. Terminal SDK (`packages/terminal-sdk`)

- `createReceipt(crfDraft)` generates a UUIDv7 and a 32-byte secret. It signs version 1, stores it in the local SQLite queue (`better-sqlite3` in Node), and returns `{ receiptId, secret, qrUrl }` **immediately**, before any network call.
- `addVersion(receiptId, patch)` builds the next version, signs it and enqueues it.
- A background flusher uploads the queue in order: single uploads when online, `POST /v1/receipts:batch` (≤500) after an outage. It uses exponential backoff with jitter and a stable `Idempotency-Key` per version.
- `qrUrl(receiptId, secret)` returns `https://<RECEIPT_HOST>/r/<id>#<base64url(secret)>`. Also render an SVG QR.
- Ship an example CLI (`pnpm --filter terminal-sdk demo`) that creates sales and simulates going offline.

## 9. Merchant API (`apps/merchant-api`)

Auth: `Authorization: Bearer <terminal API key>`, plus `X-Signature` (Ed25519 over the request body) and `X-Terminal-Id`. Each receipt version payload also carries its own signature.

| Method | Path | Behaviour |
|---|---|---|
| POST | `/v1/receipts` | Body `{ version: CRF, signature, claimSecretHash }`. Creates the receipt + v1. |
| POST | `/v1/receipts/:id/versions` | Body `{ version: CRF, signature }`. Validates transition, gap, signature. |
| POST | `/v1/receipts:batch` | Array of the above. Per-item result; partial success allowed. |
| GET | `/v1/receipts/:id` | Own org only. |
| GET | `/v1/terminals/me` | Config + server time. |

Every write needs an `Idempotency-Key`. Return `201`/`200` on a replay with identical content, and `409 idempotency_conflict` when the content differs. Set `claimable_until = received_at + CLAIM_WINDOW_DAYS` (default 90).

## 10. Buyer API + public resolver (`apps/buyer-api`)

**Public, no auth.** Rate limits: 30 requests/min per IP, and 10 failed secrets per receipt per hour, then 429.

- `POST /v1/resolve/secret {receiptId, secret}` returns one of:
  - `{status:"pending"}` when the receipt is not uploaded yet;
  - `{status:"ok", preview:{merchantName, locationName, total, currency, createdAt, state, claimed:boolean}}`;
  - 404 when the secret is wrong. Return the same 404 shape whether the ID or the secret is wrong.
- `GET /v1/resolve/tag/:tagId?picc=<hex>&cmac=<hex>`: verify NTAG 424 DNA SUN.
  - Decrypt the PICC data with the tag's SDM meta key to get the UID and counter.
  - Verify the CMAC with the session MAC key.
  - Require counter > `last_counter`, then store it.
  - Find receipts for that terminal, in state ≥ `presented`, unclaimed, with `received_at` or `created_on_terminal_at` within the last `TAP_WINDOW_SECONDS` (default 120).
  - Create a `tap_session` (5 min) and return `{tapSessionId, candidates:[preview+receiptId]}`.
  - Implement SUN per NXP AN12196 and include its published test vectors as unit tests. Provide a dev mode (`NFC_DEV_MODE=true`) that accepts `?dev=1&counter=N` for the simulator.
- `POST /v1/resolve/view {receiptId, secret}` returns the full latest CRF + version list for the web viewer.

**Authenticated buyer.** Email one-time code (6 digits, 10 min, sent via SMTP / Mailpit locally) creates a session. Passkeys (WebAuthn via `@simplewebauthn/server`) are optional to add after login. Sessions are opaque random tokens stored hashed.

| Method | Path | Behaviour |
|---|---|---|
| POST | `/v1/auth/email/start`, `/v1/auth/email/verify` | Login/signup |
| POST | `/v1/me/claims` | `{receiptId, secret}` or `{tapSessionId, receiptId}`. Fails with 409 `already_claimed` if owned by someone else; idempotent if already owned by the caller. Rejects past `claimable_until`. |
| GET | `/v1/me/receipts` | Cursor pagination, filters (merchant, category, date range, state), search on merchant/description |
| GET | `/v1/me/receipts/:id` | Latest CRF + all versions; only if claimed by the caller |
| POST | `/v1/me/uploads` | Returns a presigned PUT URL; then `POST /v1/me/uploads/:id/complete` enqueues extraction |
| PATCH | `/v1/me/uploads/:id` | User corrections for `needs_review` |
| POST | `/v1/me/uploads/:id/accept-match` | Replace the photo with the matched official receipt (creates a claim with source `photo_match`) |
| GET | `/v1/me/insights` | Spend per month, by category, top merchants, price changes of repeated items (same merchant + sku/description) |
| PUT | `/v1/me/consents` | Append consent rows |
| POST | `/v1/me/devices` | Register push token |
| GET | `/v1/me/export` | JSON export of everything about the user |
| DELETE | `/v1/me` | Soft-delete now; worker hard-deletes claims, uploads (S3 objects too), devices and sessions after 30 days |

## 11. Worker (`apps/worker`)

Jobs:
- **`extract-upload`**: fetch from S3 and call the Claude API (`ANTHROPIC_API_KEY`, model from env, default a current Sonnet model) with the image and a strict prompt returning CRF JSON. Validate with Zod and run the arithmetic checks from §5 (2-cent tolerance for photos). Set `done` or `needs_review` with confidence. Then:
  - If `merchant.vatNumber` matches an organisation and an unclaimed receipt has the same gross within ±30 min, set `matched_receipt_id`.
  - Else, if the VAT number is unknown, upsert `leads.unknown_merchants` and the distinct uploader. When `distinct_uploaders` reaches `LEAD_THRESHOLD` (default 20), set the status to `new` and make it visible in the admin view.
  - Provide a fake extractor (`EXTRACTOR=fake`) used in tests and when no API key is set.
- **`notify-version`**: on a new version of a claimed receipt, send an Expo push to the owner's devices.
- **`rollup-daily`**: maintain `daily_rollups` and `receipt_lines`.
- **`export`**: CSV per period and accountant export (VAT totals per day). Upload to S3 and return a presigned link valid 24 h.
- **`retention`**: nightly. Delete receipts past the organisation's retention (default 10 years), hard-delete buyers 30 days after `deleted_at`, and expire tap sessions and email codes.
- **`categorise`**: assign `category` per line from a rule table (keywords, MCC-like merchant categories) when the CRF has none. Flag `pharmacy`/`health` as sensitive.

Trigger jobs from the APIs via pg-boss. Use `LISTEN/NOTIFY` for low latency.

## 12. Web (`apps/web`, Next.js)

- **`/r/[id]`, the public viewer.** Reads the secret from `location.hash` and calls `/v1/resolve/view`. Renders the receipt (lines, VAT, totals, payments, fiscal reference, version history) and shows a "Not a fiscal document" banner for `presented`. It offers "Download PDF" (server-rendered PDF via the buyer API or `@react-pdf/renderer`) and "Save to app" (deep link plus store links). It shows a "pending" state with auto-retry when not uploaded yet. Mobile-first and accessible.
- **`/t/[tagId]`.** Same idea for NFC taps without the app: show the candidates and let the visitor view one.
- **`/dashboard`.** Merchant login (email + password + TOTP; TOTP is enrolled at first login). Pages:
  - organisation;
  - locations;
  - terminals: create, show the API key once, register the signing public key, revoke;
  - NFC tags: register UID + key, show the URL template to write;
  - receipts archive: search, filters, version history, PDF;
  - reports from rollups: daily/monthly sales, VAT by rate, sales by hour, top items, average ticket, voids;
  - exports;
  - retention setting;
  - users and roles (owner, manager, accountant read-only).
- **`/admin`** (internal, env-gated): leads list with counts only.
- **`/simulator`, the POS simulator** running the terminal SDK in the browser (IndexedDB queue instead of SQLite behind the same interface). It includes:
  - a product grid and cart;
  - "Present bill" (presented), "Add item" (new version), "Pay" (paid), "Fiscalise" (adds a fake RT serial + document number), "Void";
  - a big QR for the current receipt;
  - an "Offline" toggle that pauses uploads;
  - a "Simulate NFC tap" link using dev-mode SUN params.

## 13. Mobile app (`apps/mobile`, Expo)

- **Linking.** Universal links / App Links for `https://<RECEIPT_HOST>/r/*` and `/t/*`, plus a custom scheme for dev. Include `apple-app-site-association` and `assetlinks.json` served by `apps/web`.
- **Flows.**
  - Onboarding: email code login, consent toggles (all off by default), notification permission.
  - Open from link or QR scan: parse id + secret, call `resolve/secret`, then show the confirmation sheet (merchant, total, time, first lines, "Save receipt" / "Not mine"). Save calls `/me/claims`.
  - Open from tag: call `resolve/tag`; with one candidate show the sheet; with several show a picker with total + time.
  - Android in-app "Tap to receive" via foreground NFC reading the NDEF URL. iOS relies on background tag reading opening the universal link.
- **Wallet.** List grouped by day, search, filters, "Arriving" section for pending claims. Receipt detail with version history. Pull to refresh. Push opens the detail.
- **Insights screen** with simple charts (`victory-native` or `react-native-svg`).
- **Add receipt.** Camera or file picker, upload, status, correction form for `needs_review`, "Official receipt found — replace?" prompt.
- **Settings.** Consents, export, delete account, logout.
- **Offline.** Cache receipts in SQLite and read offline. When resolve/claim fails for network reasons or returns `pending`, store a pending claim `{receiptId, secret, createdAt}`. Retry on app foreground, on connectivity change, and with a background fetch task, for up to 7 days. Then show "Couldn't get this receipt — ask the shop".

## 14. Security requirements

- argon2id for passwords. API keys and session tokens: 32 random bytes, shown once, stored as SHA-256.
- Encrypt `sdm_key_encrypted` and `totp_secret_encrypted` with an envelope key. Locally use an AES-256-GCM key from env; in prod use KMS, behind a `KeyProvider` interface.
- Helmet-equivalent headers, strict CORS (web origin only for buyer API browser calls), request size limits, Zod validation on every input.
- Rate limiting via `@fastify/rate-limit` with Postgres or in-memory store (document the choice).
- Logger redaction for `authorization`, `secret`, `email`, `payload`, `token`.
- Audit log entries for: terminal key creation/revocation, tag registration, claim, failed signature, idempotency conflict, account deletion.

## 15. Local dev, seed and docs

- `docker compose up -d` then `pnpm i && pnpm db:migrate && pnpm db:seed && pnpm dev` must start everything.
- The seed creates:
  - org "Bar Roma" (IT VAT) with 1 location, 2 terminals with keys, and 1 NFC tag in dev mode;
  - a merchant owner `owner@example.test`;
  - a buyer `buyer@example.test`;
  - 200 historical receipts over 60 days, 30 of them claimed by the buyer;
  - 3 uploads, one matching an official receipt.
- `.env.example` per app, validated at startup with Zod.
- Docs:
  - `README.md` (quickstart, demo script);
  - `docs/ARCHITECTURE.md` (components, schemas/roles, flows as Mermaid diagrams);
  - `docs/API.md` (links to generated OpenAPI);
  - `docs/DECISIONS.md` (every choice you made);
  - `docs/RUNBOOK.md` (deploy, migrate, rotate keys, incident basics).

## 16. Tests you must write and pass

Unit:
- CRF validation and arithmetic;
- JCS + Ed25519 sign/verify;
- secret hashing and constant-time compare;
- SUN/CMAC with the NXP test vectors;
- lifecycle transition table;
- categoriser rules.

Integration (real Postgres):
1. Create → present → add version → pay → fiscalise via the merchant API; versions are immutable and ordered.
2. Idempotent replay returns the same result; changed content returns 409.
3. Version gap returns 409; the batch upload later fills it in order.
4. Resolve by secret before upload returns `pending`; after upload it returns a preview; a wrong secret returns 404; the rate limit kicks in.
5. Claim by secret succeeds; a second user gets `already_claimed`; the same user is idempotent; past `claimable_until` is rejected.
6. NFC tap: a valid dev tap with one candidate goes through; two candidates show the picker data; a replayed counter is rejected; no candidates returns an empty list.
7. A new version on a claimed receipt enqueues `notify-version`.
8. **Privacy:** connected as `merchant_api` and as `dashboard`, every `SELECT` on `buyer.*` fails; merchant API responses never contain claim info.
9. RLS: org A cannot read org B receipts via the merchant API or dashboard.
10. Upload with the fake extractor: `done`; a match is found and accept-match creates a claim; an unknown VAT number increments leads and passes the threshold.
11. Account deletion: claims gone after the retention job; merchant receipts still exist.
12. Exports produce correct VAT totals for the seeded data.

E2E (Playwright, web):
- In the simulator, create a sale and present it. Open the `/r/...#secret` URL in a second browser context and see the pre-bill with the banner. Pay and fiscalise in the simulator; the viewer shows the final version.
- Toggle offline in the simulator, make 3 sales, toggle online, and all 3 appear in the dashboard archive.
- Dashboard: log in with TOTP, create a terminal, see the key once, revoke it.

Mobile: unit-test the link parser, pending-claim store and retry logic with Jest (`jest-expo`). The mobile app must `expo export` without errors.

## 17. Definition of done

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass from a clean clone. Playwright E2E passes against `pnpm dev`. `terraform validate` passes. CI workflow is included.
- The README demo script works: open the simulator, sell, scan the QR with the Expo app (or open the link), confirm "Save this receipt?", and see it in the wallet; edit the pre-bill and get a push; fiscalise and see the final version.
- No TODOs in critical paths: claims, signatures, idempotency, RLS/roles, SUN verification, offline queue. Anything deliberately left out is listed in `docs/DECISIONS.md` under "Deferred": Open Banking matching, NFC pad v2, bill splitting, social features, data products, ERP connectors, certified fiscal integration.

Build in this order, committing after each step with passing tests:
1. schema
2. crypto
3. db + roles
4. merchant-api
5. terminal-sdk
6. buyer-api/resolver
7. worker
8. web viewer + simulator
9. dashboard
10. mobile
11. infra + CI
12. docs
