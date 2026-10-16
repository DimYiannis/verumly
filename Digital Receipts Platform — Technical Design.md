# Digital Receipts Platform — Technical Design

Oct 16, 2026 · @Marco Tarantino

## Overview

The MVP issues every receipt digitally and stores it without knowing who bought it. A buyer gets it into their wallet by scanning a QR code or tapping an NFC point. Merchants pay for issuance, storage and reporting. Buyers use the app for free.

**Goals of the MVP**

- Merchants send receipts through an API; we store them under the merchant's identity only.
- Buyers claim a receipt in one gesture (QR or NFC tap), confirm "Save this receipt?", and see it in the app.
- Receipts have a lifecycle: a pre-bill can be shown and updated before payment, then becomes the final receipt.
- Everything works with poor or no connectivity on either side.
- Buyers can add photos of paper receipts; unknown shops become sales leads.

**Not in the MVP:** bank or card matching, the active NFC pad (v2), social features, bill splitting, data products, ERP connectors, certified fiscal integration. The data model is built so each can be added without migration pain.

**Launch assumption:** Italy first, Germany second. See Open questions.

## Key decisions

Each decision below is final for the MVP unless an open question reverses it.

| Area | Decision | Why |
| --- | --- | --- |
| Buyer identity on receipts | None. Receipts carry merchant, location and terminal only. Ownership lives in a separate claims table. | Privacy by design; the merchant side never learns who bought. |
| Claim proof | A 256-bit secret generated on the terminal per receipt. We store only its SHA-256 hash. | Whoever holds the QR or tap holds the receipt, like paper. Works offline. |
| QR format | `https://r.<domain>/r/<receiptId>#<secret>` | The fragment never reaches servers or logs; app and web read it locally. |
| NFC v1 | One static NTAG 424 DNA sticker per till, with SUN authentication. A tap resolves to that till's unclaimed receipts from the last 120 s. | About €1 per till, no POS hardware. SUN proves a physical tap. |
| NFC v2 | Active pad with a dynamic NFC tag; the POS writes each receipt's exact URL. | Exact match, no time window. Phase 2. |
| Confirmation | Every claim shows merchant, total and time, then "Save this receipt?" | Prevents wrong-receipt claims at busy tills. |
| Receipt IDs | UUIDv7, generated on the terminal. | Offline creation, time-ordered, idempotent upload. |
| Integrity | Each terminal has an Ed25519 key; every receipt version is signed over canonical JSON (RFC 8785). | Proves authenticity before and after sync. |
| Lifecycle | Versioned receipts: open → presented → paid → fiscalised, plus void. Versions are immutable. | Supports the pre-bill and edits without losing history. |
| Format | One Canonical Receipt Format (CRF v1) for every source. | POS, NFC, photos and later ERPs all map to it. |
| Language | TypeScript everywhere, pnpm + Turborepo monorepo. | One schema package (Zod) shared by API, app and dashboard. |
| Backend | Fastify API, Drizzle ORM, PostgreSQL 16, pg-boss job queue. | Few moving parts; queue lives in Postgres. |
| Buyer app | Expo (React Native), iOS and Android. | One codebase; NFC and universal links supported. |
| Web | Next.js for the merchant dashboard and the public receipt viewer. | Receipt links must open without the app. |
| Hosting | AWS eu-south-1 (Milan), Terraform. | EU and Italian data residency. |
| Photo extraction | Claude vision API in a worker, output validated against CRF. | Handles messy receipts and line items. |
| Auth | Buyers: passkeys + email one-time code. Merchants: email, password and TOTP. Terminals: API key + signing key. | Low friction for buyers, strong for merchants. |

## Architecture

Six deployables share one Postgres database split into schemas with separate roles. The merchant side and the buyer side never read each other's schema.

| Component | Tech | Responsibility |
| --- | --- | --- |
| Terminal SDK | TypeScript package + SQLite queue | Runs beside the POS. Creates IDs and secrets, signs versions, queues offline, uploads, renders QR. |
| Merchant API | Fastify | Receipt ingest, versions, finalise, void, batch upload. Writes only the `merchant` schema. |
| Buyer API | Fastify | Claims, wallet, uploads, insights, consents, account deletion. Writes only the `buyer` schema. |
| Public resolver | Fastify, same service as Buyer API | Resolves QR secrets and NFC taps to a receipt without login. |
| Worker | Node + pg-boss | Photo extraction, matching, report rollups, lead counting, retention jobs, push. |
| Web | Next.js | Merchant dashboard, public receipt viewer, POS simulator for demos and tests. |
| Buyer app | Expo | Wallet, QR scan, NFC tap handling, confirmation sheet, insights, photo upload. |

**Storage:** Postgres (RDS) for all records, S3 for photos and exports. **Push:** Expo push service to APNs and FCM. **Schemas:** `merchant`, `buyer`, `leads`, `ops`. The `analytics` schema is reserved for later.

## Core flow

The receipt exists in our database before anyone claims it, and it only ever points to the merchant.

1. **Transaction.** The POS sends the sale to the Terminal SDK. The SDK creates `receiptId` (UUIDv7) and a random `secret`, signs the version, and stores it locally.
2. **Show.** The till's customer display shows the QR with the secret. The NFC sticker is always on the counter.
3. **Upload.** The SDK posts the receipt with `sha256(secret)` to the Merchant API, immediately or when back online. We store merchant, location, terminal, content, hash. No buyer data.
4. **Gesture.** The buyer scans the QR or taps the sticker. iOS and Android show a system banner that opens our app (or the web viewer if not installed).
5. **Resolve.** The app sends the secret, or the signed tap data, to the public resolver. It returns a preview: merchant name, total, time.
6. **Confirm.** The app shows "Save this receipt?" with that preview. Nothing is assigned until the buyer taps Save.
7. **Assign.** The Buyer API creates a row in `buyer.claims` linking the user to `receiptId`. One owner per receipt; a second claim attempt is refused.
8. **See it.** The app fetches the full receipt and caches it. Later versions (pre-bill → final) arrive by push.

**Without the app**, step 4 opens the web viewer. The buyer sees the receipt and can download a PDF or install the app to keep it. The secret stays valid, so they can claim it later.

**What the merchant sees:** nothing about claims in the MVP. They see their receipts, reports and exports.

&#91;embedded content: claim flow · merchant side and buyer side\]

The top row never touches buyer data; the bottom row creates the only link, after the buyer confirms.

## Matching and offline

QR is exact and is the legal baseline. The NFC sticker is the nicer gesture and resolves by till and time.

### QR (exact)

- The URL carries `receiptId` and `secret`. The resolver checks `sha256(secret)` against the stored hash.
- The QR can be shown before upload, because the terminal generated both values.
- Secrets never expire for viewing. Unclaimed receipts become unclaimable after 90 days (configurable).

### NFC sticker v1 (till + time window)

- Each till gets an NTAG 424 DNA sticker. Its URL is `https://r.<domain>/t/<tagId>?picc=…&cmac=…`, rewritten by the chip on every tap.
- The resolver verifies the CMAC with the tag's key and rejects a counter that has not increased. This proves a real, fresh tap.
- It then lists unclaimed receipts from that till created in the last 120 s, in state presented or later.
- One candidate: show it. Several: show each with total and time; the buyer picks. None: "No receipt yet" with a retry for 60 s.
- The resolver returns a short-lived tap session (5 min) instead of secrets. The claim call uses that session.

### NFC pad v2 (exact, Phase 2)

A small device with a dynamic NFC tag (for example ST25DV) and Wi-Fi or USB. The SDK writes the exact QR URL into the tag per receipt. The buyer experience is identical to QR, but by tap.

### Offline behaviour

| Who is offline | What happens |
| --- | --- |
| Merchant | SDK queues signed versions in SQLite and retries with backoff. QR still works because the secret is local. NFC v1 waits for upload. |
| Buyer | App stores the scanned `receiptId` + `secret` as a pending claim and retries. The receipt shows as "Arriving" until it syncs. |
| Both | The pending claim waits on the phone and the receipt waits on the till. Whichever reconnects last completes it. |
| Receipt not uploaded yet | Resolver returns `pending`. The app retries for 7 days, then asks the buyer to check with the shop. |

Uploads are idempotent on `receiptId` + version number. A replayed upload with different content is rejected and logged.

## Receipt lifecycle

A receipt is one ID with many immutable versions. The pre-bill and the final receipt are the same document at different states.

| State | Meaning | Claimable | Fiscal |
| --- | --- | --- | --- |
| `open` | Order running, items being added. Not shown to buyers. | No | No |
| `presented` | Merchant shares the bill (restaurant *conto*). Can still change. | Yes | No, marked "not a fiscal document" |
| `paid` | Payment recorded. | Yes | Not yet |
| `fiscalised` | Official fiscal reference attached (register serial + document number). | Yes | Yes |
| `void` | Cancelled or fully refunded. Linked to a credit version when refunded. | View only | As per register |

**Rules**

- Allowed transitions: open → presented → paid → fiscalised; presented → presented (new version); any state → void.
- Every change is a new version with a version number, signature and timestamp. Old versions stay readable.
- A buyer who claims at `presented` follows the receipt. They get a push when it reaches `fiscalised`.
- The buyer app shows the newest version. A "history" view lists earlier versions.
- Pre-bills must still go through the till's normal legal flow. In Germany, interim bills may need recording in the certified security device; verify per country.

Pre-bills work for any merchant from day one, not only restaurants. The state is optional: a shop can go straight to `paid`.

## Data model

The only link between a person and a receipt is `buyer.claims`. Postgres roles stop the merchant API from reading the `buyer` schema.

### Schema `merchant`

| Table | Key columns |
| --- | --- |
| `organizations` | id, legal\_name, vat\_number, country, plan, created\_at |
| `locations` | id, org\_id, name, address, lat, lng, timezone |
| `terminals` | id, location\_id, label, api\_key\_hash, signing\_public\_key, last\_seen\_at |
| `nfc_tags` | id, terminal\_id, uid, sdm\_key\_encrypted, last\_counter, active |
| `receipts` | id (UUIDv7), org\_id, location\_id, terminal\_id, state, current\_version, claim\_secret\_hash, total\_minor, currency, created\_on\_terminal\_at, received\_at, claimable\_until |
| `receipt_versions` | receipt\_id, version, state, payload (CRF jsonb), signature, created\_on\_terminal\_at, received\_at; PK (receipt\_id, version) |
| `receipt_lines` | receipt\_id, line\_no, sku, description, qty, unit\_price\_minor, vat\_rate, total\_minor (latest version, for reports) |
| `merchant_users` | id, org\_id, email, password\_hash, totp\_secret\_encrypted, role |

### Schema `buyer`

| Table | Key columns |
| --- | --- |
| `users` | id, email, display\_name, locale, created\_at, deleted\_at |
| `passkeys` | id, user\_id, credential\_id, public\_key, sign\_count |
| `devices` | id, user\_id, platform, push\_token, last\_seen\_at |
| `claims` | receipt\_id (unique), user\_id, source (qr, nfc, link), claimed\_at |
| `uploads` | id, user\_id, s3\_key, status, extracted (CRF jsonb), confidence, merchant\_vat, matched\_receipt\_id |
| `consents` | user\_id, purpose, granted, policy\_version, changed\_at (append-only) |
| `tap_sessions` | id, tag\_id, candidate\_receipt\_ids, expires\_at |

### Schemas `leads` and `ops`

- `leads.unknown_merchants`: vat\_number, name, address, distinct\_uploaders, first\_seen\_at, status.
- `ops.audit_log`, `ops.idempotency_keys`, pg-boss tables.

Money is stored as integer minor units with ISO 4217 currency. All timestamps are UTC `timestamptz`.

## APIs

All APIs are JSON over HTTPS, versioned under `/v1`, described in OpenAPI generated from the shared Zod schemas.

### Canonical Receipt Format (CRF v1)

```json
{
  "crf": "1",
  "receiptId": "0192f1c2-…",
  "version": 2,
  "state": "fiscalised",
  "merchant": { "vatNumber": "IT01234567890", "name": "Bar Roma", "locationId": "…", "terminalId": "…" },
  "createdAt": "2026-10-16T12:31:05Z",
  "currency": "EUR",
  "lines": [ { "lineNo": 1, "sku": "ESP", "description": "Espresso", "qty": 2, "unitPrice": 120, "vatRate": 10, "discount": 0, "total": 240 } ],
  "vatSummary": [ { "rate": 10, "net": 218, "vat": 22 } ],
  "totals": { "net": 218, "vat": 22, "gross": 240, "tip": 0 },
  "payments": [ { "method": "card", "amount": 240 } ],
  "fiscal": { "country": "IT", "registerSerial": "…", "documentNumber": "0042-0117", "extra": {} },
  "notes": null
}
```

Amounts are minor units. `fiscal.extra` holds country fields (for example German TSE signature data). No buyer field exists in CRF.

### Merchant API (terminal API key + Ed25519 request signature)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/receipts` | Create receipt with version 1 and `claimSecretHash` |
| POST | `/v1/receipts/{id}/versions` | Add a version (edit pre-bill, mark paid, fiscalise, void) |
| POST | `/v1/receipts:batch` | Upload up to 500 queued versions after an outage |
| GET | `/v1/receipts/{id}` | Read own receipt |
| GET | `/v1/terminals/me` | Terminal config and server time |

Every write needs an `Idempotency-Key` header. The server rejects a version whose signature fails or whose number skips.

### Public resolver (no login)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/resolve/secret` | Body `{receiptId, secret}` → preview or `pending` |
| GET | `/v1/resolve/tag/{tagId}?picc&cmac` | Verify tap → tap session + candidate previews |
| POST | `/v1/resolve/view` | Full receipt for the web viewer, given a valid secret |

Rate limit: 30 requests per minute per IP and 10 failed secrets per receipt per hour.

### Buyer API (session token)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/me/claims` | Claim by `{receiptId, secret}` or `{tapSessionId, receiptId}` |
| GET | `/v1/me/receipts` | Wallet list, cursor pagination, filters |
| GET | `/v1/me/receipts/{id}` | Full receipt with version history |
| POST | `/v1/me/uploads` | Get a presigned S3 URL for a photo or PDF |
| GET | `/v1/me/insights` | Spend by month, category and merchant |
| PUT | `/v1/me/consents` | Grant or withdraw a purpose |
| GET | `/v1/me/export` | GDPR data export |
| DELETE | `/v1/me` | Delete account and claims |

### Dashboard API (merchant user session)

Organisation, locations, terminals, API keys, NFC tag provisioning, receipt search, reports and exports.

## Buyer app

The app opens straight into the confirmation sheet when launched by a QR or tap. Everything else is a wallet with insights.

**Entry points**

- Universal links (iOS) and App Links (Android) on `r.<domain>/r/*` and `r.<domain>/t/*`.
- iOS background tag reading: the tap shows a system banner; tapping it opens the app on the receipt.
- In-app scanner for QR codes, and an in-app "Tap to receive" button on Android using foreground NFC.

**Screens**

1. Onboarding: email code or passkey, consent choices, optional notifications permission.
2. Confirmation sheet: merchant, total, time, line preview, "Save receipt" and "Not mine".
3. Wallet: list by date, search, filter by merchant or category, "Arriving" items for pending claims.
4. Receipt detail: lines, VAT, payments, fiscal reference, version history, share as PDF.
5. Insights: spend per month, top merchants, top categories, price changes for repeated items.
6. Add receipt: camera or file picker for photos and PDFs, with extraction status.
7. Settings: consents, data export, delete account.

**Offline:** receipts cache in on-device SQLite. Pending claims and uploads retry in the background. The wallet works fully offline for reading.

**Categories:** each line gets a category (groceries, dining, pharmacy, etc.) from a rule table plus the extraction model. Pharmacy and health lines are flagged sensitive.

## Merchant dashboard

The dashboard is the paid product: setup, archive, reports and exports. It never shows who claimed a receipt.

- **Setup:** organisation, locations, terminals, API keys, signing key registration, NFC tag provisioning (write URL template and keys).
- **Archive:** search receipts by date, number, amount, state; view all versions; download PDF.
- **Reports:** daily and monthly sales, VAT summary by rate, sales by hour, top items, average ticket, voids and refunds.
- **Exports:** CSV per period and an accountant export (VAT totals per day). Generated by the worker, stored in S3, link valid 24 h.
- **Retention:** default 10 years per receipt, configurable per organisation, enforced by a nightly job.
- **POS simulator:** a web page that acts as a terminal, for demos, onboarding and end-to-end tests. It shows the QR on screen.

Roles: owner, manager, accountant (read and export only).

## Photo upload and outreach

A photo becomes a structured receipt in under a minute. When the shop is a client, the official receipt replaces it.

1. App requests a presigned URL and uploads the image or PDF to S3.
2. Worker sends it to the Claude vision API with a prompt that returns CRF JSON. The output is validated with the Zod schema.
3. Checks: lines sum to totals within 2 cents, VAT summary matches, date is not in the future. Failures set `needs_review` and the user can correct fields.
4. Matching: if `merchant.vatNumber` belongs to a client and an unclaimed receipt has the same total within ±30 minutes, offer "We found the official receipt — replace?"
5. Otherwise the upload stays in the wallet as a user record, marked "from photo".

**Outreach to non-client shops**

- Each upload with an unknown VAT number increments `leads.unknown_merchants.distinct_uploaders`.
- At 20 distinct uploaders the lead appears in an internal admin list with counts only.
- No automated email in the MVP. Outreach is manual or through partners, because cold-email rules are strict in Italy and Germany.
- The pitch never reveals which customers uploaded, only how many.

## Security and GDPR

We are processor for merchant receipts and controller for buyer accounts and claims. The database enforces that split.

**Access separation**

| Database role | Can read | Can write |
| --- | --- | --- |
| `merchant_api` | `merchant` | `merchant`, `ops` |
| `buyer_api` | `buyer`; `merchant` receipts, versions, locations (read-only) | `buyer`, `leads`, `ops` |
| `worker` | all except password and key columns | `buyer.uploads`, `leads`, rollup tables, `ops` |
| `dashboard` | `merchant`, rollups | `merchant` users, terminals, tags |

No role used by merchants can query `buyer`. Row-level security limits `merchant` rows to the caller's organisation.

**Secrets and keys**

- Claim secrets: 256 bits, stored as SHA-256 only, compared in constant time.
- NFC SDM keys and TOTP secrets: encrypted with AWS KMS envelope keys.
- API keys: shown once, stored as hashes, scoped to one terminal, revocable.
- TLS everywhere, encryption at rest on RDS and S3, no card numbers stored.

**GDPR measures**

- Consent ledger per purpose: `analytics_aggregate`, `marketing`, `research_panel`. All default off.
- Lines flagged sensitive (pharmacy, health) are never used for anything except the buyer's own wallet.
- Data export and account deletion in the app. Deletion removes claims, uploads and devices within 30 days; merchant receipts stay as the merchant's record.
- A processing agreement template for merchants, a record of processing activities, and a DPIA before launch.
- Logs never contain secrets, tokens, emails or receipt content. Request IDs only.

**Abuse controls:** rate limits on resolvers and claims, CMAC counter checks on taps, alerting on repeated failed secrets.

## Fiscal compliance

In the MVP our receipt is a digital copy linked to the official fiscal document, not a replacement for it. Replacing paper legally needs a certified integration per country.

| Country | Official document comes from | MVP behaviour | Needed to replace paper |
| --- | --- | --- | --- |
| Italy | Telematic register (RT) transmitting to the Agenzia delle Entrate | Store RT serial and document number in `fiscal`; paper still printed | Integration with RT vendors or certified register software, per the 2027–2029 digital rules |
| Germany | Till with certified security device (TSE) | Store TSE fields in `fiscal.extra` | Meet the digital receipt provision rules expected from 2028 |
| France | Certified till software | Store reference only | Digital by default is already allowed; mandatory fields must be shown |

The CRF `fiscal` block is designed so a certified integration only fills fields; the rest of the system does not change. Legal review in Italy is required before the pilot.

## Infrastructure

Everything runs in AWS eu-south-1 (Milan), defined in Terraform, deployed by GitHub Actions.

| Concern | Choice |
| --- | --- |
| Compute | ECS Fargate services: merchant-api, buyer-api, worker, web |
| Database | RDS PostgreSQL 16, Multi-AZ in prod, point-in-time recovery 35 days |
| Files | S3 with SSE-KMS, lifecycle rules for exports (7 days) |
| Edge | CloudFront + WAF in front of web and APIs |
| Secrets | AWS Secrets Manager and KMS |
| Environments | `dev` (local), `staging`, `prod`; staging gets every merge to `main`, prod on a tagged release |
| Migrations | Drizzle migrations run as a one-off task before each deploy |
| Mobile releases | EAS Build and EAS Update; TestFlight and Play internal track for staging |
| Observability | OpenTelemetry traces and metrics, structured JSON logs, Sentry for errors |
| Alerts | API error rate above 1%, p95 latency above 500 ms, queue backlog above 1,000 jobs, failed uploads |

**Local development:** `docker compose up` starts Postgres, MinIO (S3) and Mailpit. `pnpm dev` runs all apps. A seed script creates a demo merchant, two terminals and a test buyer.

## Roadmap

Each phase has an exit criterion; dates depend on team size (open question).

1. **Phase 0 — MVP build.** Everything in this document, with the POS simulator. Exit: end-to-end tests pass for QR, NFC v1, offline and pre-bill flows.
2. **Phase 1 — Pilot in Italy.** 10 to 20 merchants, one POS integration, NFC stickers, legal review. Exit: 30% of transactions at pilot shops claimed, no data incidents.
3. **Phase 2 — Exact tap and money features.** NFC pad v2, bill splitting on pre-bills, Open Banking matching, certified Italian fiscal integration. Exit: paper optional at pilot shops.
4. **Phase 3 — Scale and data.** Aggregated data products on consented data, ERP connectors (API, SFTP, EDI), Germany launch.

## Open questions

- [ ] Is Italy confirmed as the launch country?
- [ ] Product name and domain (needed for receipt URLs and app links).
- [ ] Which POS or register vendor will be the first integration partner?
- [ ] Team size and stack familiarity: is TypeScript everywhere a fit?
- [ ] Should merchants see an aggregate claim rate (counts only)? The MVP shows nothing.
- [ ] Unclaimed receipts become unclaimable after 90 days: right window?
- [ ] Merchant pricing model (per terminal, per receipt, or per location)?
